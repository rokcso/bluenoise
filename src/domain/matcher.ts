import type {
	AppConfig,
	KeywordSubscription,
	Matchers,
} from "@/src/contracts/config";
import {
	asRegex,
	buildWhitelistIndex,
	INVISIBLE_CHARS_RE,
	isSafeCustomRegex,
	MAX_CUSTOM_REGEX_COUNT,
	normalizeKeyword,
	normalizeStrict,
} from "@/src/domain/normalize";

/** Max keywords per merged big-regex chunk. Too big = slow compile, too small = too many chunks. */
const CHUNK_SIZE = 400;

/**
 * Compile "built-in + community + user" rules into matchers, skipping whitelisted
 * rules. Duplicate rules across the lists are de-duplicated here. Called only on
 * config change, never on the scanning hot path.
 */
export function buildMatchers(
	cfg: Pick<AppConfig, "caseSensitive" | "ignoreSpaces"> & {
		subscriptions: KeywordSubscription[];
		userKeywords: string[];
		whitelist: string[];
	},
): Matchers {
	// Collect raw rules tagged with their source label: a subscription name or
	// "user" for the user's own list. Kept so debug logs can say which list a
	// hit came from, not just the matched keyword.
	const items: { raw: string; source: string }[] = [];
	for (const source of cfg.subscriptions ?? []) {
		if (source.enabled) {
			for (const kw of source.keywords ?? []) {
				items.push({ raw: String(kw || ""), source: source.name });
			}
		}
	}
	if (cfg.userKeywords?.length) {
		for (const kw of cfg.userKeywords) {
			items.push({ raw: String(kw || ""), source: "user" });
		}
	}

	// Both keyword lists are read-only snapshots, so false positives are removed
	// via the whitelist, which applies to all three sources.
	const whitelist = buildWhitelistIndex(cfg.whitelist, cfg);

	const plain: string[] = [];
	const loose: string[] = [];
	const plainSources = new Map<string, string>();
	const plainRules = new Map<string, string>();
	const looseSources = new Map<string, string>();
	const looseRules = new Map<string, string>();
	const seenPlain = new Set<string>();
	const seenRegex = new Set<string>();
	const custom: { source: string; re: RegExp }[] = [];
	const customSources = new Map<string, string>();

	for (const item of items) {
		const kw = item.raw.trim();
		if (!kw || whitelist.has(kw)) continue;

		const asRegexMatch = asRegex(kw);
		if (asRegexMatch) {
			if (custom.length >= MAX_CUSTOM_REGEX_COUNT || !isSafeCustomRegex(kw))
				continue;
			if (seenRegex.has(kw)) continue;
			try {
				// /regex/flags: keep the regex's own case/whitespace semantics,
				// strip stateful g/y flags.
				const flags = asRegexMatch[2].replace(/[gy]/gi, "");
				custom.push({ source: kw, re: new RegExp(asRegexMatch[1], flags) });
				customSources.set(kw, item.source);
				seenRegex.add(kw);
			} catch {
				// Invalid regex: ignore it, it must not affect other keywords.
			}
			continue;
		}

		// The canonical form (whitespace removed) is the dedup key, so the same
		// rule from two lists still counts once.
		const canonical = normalizeKeyword(kw, cfg);
		if (!canonical || seenPlain.has(canonical)) continue;
		seenPlain.add(canonical);

		// Strict form keeps the keyword's own whitespace and gets a Latin word
		// boundary, so "check my bio" no longer hits "check my biography".
		const strict = normalizeStrict(kw, cfg);
		plain.push(strict);
		plainSources.set(strict, item.source);
		plainRules.set(strict, kw);

		// Loose form compacts whitespace / zero-width characters, so an
		// obfuscated "同 城 约" is still caught. Only non-Latin rules take part:
		// once the text is compacted a Latin rule loses every boundary, which
		// would undo the word-boundary guard above.
		if (cfg.ignoreSpaces !== false && /[^\p{ASCII}]/u.test(canonical)) {
			loose.push(canonical);
			looseSources.set(canonical, item.source);
			looseRules.set(canonical, kw);
		}
	}

	// Longest first, so a match reports the most specific word.
	plain.sort((a, b) => b.length - a.length);
	loose.sort((a, b) => b.length - a.length);

	return {
		plain: chunkPatterns(plain, true),
		loose: chunkPatterns(loose, false),
		normalization: {
			caseSensitive: cfg.caseSensitive,
			ignoreSpaces: cfg.ignoreSpaces,
		},
		custom,
		count: plain.length + custom.length,
		plainSources,
		plainRules,
		looseSources,
		looseRules,
		customSources,
	};
}

/** Merge plain keywords into a few chunked big regexes. */
function chunkPatterns(forms: string[], withWordBoundaries: boolean): RegExp[] {
	const chunks: RegExp[] = [];
	for (let i = 0; i < forms.length; i += CHUNK_SIZE) {
		const pattern = forms
			.slice(i, i + CHUNK_SIZE)
			.map((form) => escapeAlternative(form, withWordBoundaries))
			.join("|");
		chunks.push(new RegExp(pattern));
	}
	return chunks;
}

/**
 * Escape one plain keyword for the big alternation. Latin edges get a \b so the
 * keyword cannot be found inside a longer word; CJK edges do not, because
 * Chinese has no regex word boundary (a guard would never fire or would
 * truncate adjacent CJK).
 */
function escapeAlternative(form: string, withWordBoundaries: boolean): string {
	const escaped = escapeRegExp(form);
	if (!withWordBoundaries) return escaped;
	const lead = /^[A-Za-z0-9_]/.test(form) ? "\\b" : "";
	const tail = /[A-Za-z0-9_]$/.test(form) ? "\\b" : "";
	return `${lead}${escaped}${tail}`;
}

/** The matched rule plus enough context to explain the decision in a debug log. */
export interface MatchResult {
	/** The matched rule in its raw form (a plain keyword or /regex/ source). */
	hit: string;
	/** Original rule text before plain-keyword normalization. */
	rule: string;
	/** Which list it came from: a subscription name or "user". Null if unknown. */
	source: string | null;
	/** Plain keyword vs user-written custom regex. */
	kind: "plain" | "regex";
	/** Short excerpt of the matched text around the hit, for diagnostics. */
	snippet: string;
}

/** Slice a diagnostic excerpt centered on a match within a normalized string. */
function makeSnippet(
	text: string,
	index: number,
	length: number,
	radius = 32,
): string {
	if (!text) return "";
	const start = Math.max(0, index - radius);
	const end = Math.min(text.length, index + length + radius);
	const body = text.slice(start, end).replace(/\s+/g, " ").trim();
	return (start > 0 ? "…" : "") + body + (end < text.length ? "…" : "");
}

/** First plain match across the chunked regexes, with rule/source provenance. */
function firstPlainMatch(
	regexes: RegExp[],
	text: string,
	rules: Map<string, string> | undefined,
	sources: Map<string, string> | undefined,
): MatchResult | null {
	if (!text) return null;
	for (const re of regexes) {
		const match = re.exec(text);
		if (match) {
			const hit = match[0];
			return {
				hit,
				rule: rules?.get(hit) ?? hit,
				source: sources?.get(hit) ?? null,
				kind: "plain",
				snippet: makeSnippet(text, match.index, hit.length),
			};
		}
	}
	return null;
}

/** Core matcher: returns full match detail, or null if nothing matched. */
function matchCore(matchers: Matchers, text: string): MatchResult | null {
	if (!text || matchers.count === 0) return null;

	// Pass 1: match the text as written. Whitespace and newlines are preserved
	// and Latin keywords carry a word boundary, so ordinary prose is never
	// compacted into an accidental hit.
	const strictText = normalizeStrict(text, matchers.normalization);
	const strictMatch = firstPlainMatch(
		matchers.plain,
		strictText,
		matchers.plainRules,
		matchers.plainSources,
	);
	if (strictMatch) return strictMatch;

	// Pass 2: retry against a compacted form that removes whitespace and
	// zero-width characters, catching obfuscated spellings like "同 城 约".
	// Only runs when pass 1 found nothing and the text has a non-ASCII byte:
	// every loose rule is non-Latin, so a purely ASCII post cannot hit one.
	if (
		matchers.normalization.ignoreSpaces !== false &&
		matchers.loose?.length &&
		/[^\p{ASCII}]/u.test(strictText)
	) {
		const looseText = normalizeKeyword(text, matchers.normalization);
		const looseMatch = firstPlainMatch(
			matchers.loose,
			looseText,
			matchers.looseRules,
			matchers.looseSources,
		);
		if (looseMatch) return looseMatch;
	}

	// Custom regexes: keep the raw text's spaces/newlines/case, only strip
	// zero-width and direction-control chars.
	const regexText = text.replace(INVISIBLE_CHARS_RE, "");
	for (const c of matchers.custom) {
		const match = c.re.exec(regexText);
		if (match) {
			const hit = c.source;
			return {
				hit,
				rule: hit,
				source: matchers.customSources?.get(hit) ?? null,
				kind: "regex",
				snippet: makeSnippet(
					regexText,
					match.index,
					match[0]?.length ?? hit.length,
				),
			};
		}
	}
	return null;
}

/** Return the matched keyword string, or null if nothing matched. */
export function matchAny(matchers: Matchers, text: string): string | null {
	return matchCore(matchers, text)?.hit ?? null;
}

/** Return the matched keyword plus source/snippet, or null if nothing matched. */
export function matchDetail(
	matchers: Matchers,
	text: string,
): MatchResult | null {
	return matchCore(matchers, text);
}

function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
