import type { AppConfig, Matchers } from "@/src/contracts/config";
import {
	asRegex,
	buildWhitelistIndex,
	normalizeKeyword,
} from "@/src/domain/normalize";

/** Max keywords per merged big-regex chunk. Too big = slow compile, too small = too many chunks. */
const CHUNK_SIZE = 400;

/**
 * Compile "built-in + community + user" rules into matchers, skipping whitelisted
 * rules. Duplicate rules across the lists are de-duplicated here. Called only on
 * config change, never on the scanning hot path.
 */
export function buildMatchers(cfg: AppConfig): Matchers {
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
	const plainSources = new Map<string, string>();
	const seenPlain = new Set<string>();
	const seenRegex = new Set<string>();
	const custom: { source: string; re: RegExp }[] = [];
	const customSources = new Map<string, string>();

	for (const item of items) {
		const kw = item.raw.trim();
		if (!kw || whitelist.has(kw)) continue;

		const asRegexMatch = asRegex(kw);
		if (asRegexMatch) {
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

		const normalized = normalizeKeyword(kw, cfg);
		if (!normalized || seenPlain.has(normalized)) continue;
		seenPlain.add(normalized);
		plain.push(normalized);
		plainSources.set(normalized, item.source);
	}

	// Longest first, so a match reports the most specific word.
	plain.sort((a, b) => b.length - a.length);

	// Merge plain keywords into a few chunked big regexes.
	const chunks: RegExp[] = [];
	for (let i = 0; i < plain.length; i += CHUNK_SIZE) {
		const pattern = plain
			.slice(i, i + CHUNK_SIZE)
			.map((p) => escapeRegExp(p))
			.join("|");
		chunks.push(new RegExp(pattern));
	}

	return {
		plain: chunks,
		normalization: {
			caseSensitive: cfg.caseSensitive,
			ignoreSpaces: cfg.ignoreSpaces,
		},
		custom,
		count: plain.length + custom.length,
		plainSources,
		customSources,
	};
}

/** The matched rule plus enough context to explain the decision in a debug log. */
export interface MatchResult {
	/** The matched rule in its raw form (a plain keyword or /regex/ source). */
	hit: string;
	/** Which list it came from: a subscription name or "user". Null if unknown. */
	source: string | null;
	/** Plain keyword vs user-written custom regex. */
	kind: "plain" | "regex";
	/** Short excerpt of the matched text around the hit, for diagnostics. */
	snippet: string;
}

const INVISIBLE_CHARS_RE =
	/[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]+/g;

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

/** Core matcher: returns full match detail, or null if nothing matched. */
function matchCore(matchers: Matchers, text: string): MatchResult | null {
	if (!text || matchers.count === 0) return null;

	// Plain keywords: match against normalized text.
	const plainText = normalizeKeyword(text, matchers.normalization);
	if (plainText) {
		for (const re of matchers.plain) {
			const match = re.exec(plainText);
			if (match) {
				const hit = match[0];
				return {
					hit,
					source: matchers.plainSources?.get(hit) ?? null,
					kind: "plain",
					snippet: makeSnippet(plainText, match.index, hit.length),
				};
			}
		}
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
