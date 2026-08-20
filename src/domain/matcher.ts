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
	const raw: string[] = [];
	for (const source of cfg.subscriptions ?? []) {
		if (source.enabled) raw.push(...(source.keywords ?? []));
	}
	if (cfg.userKeywords?.length) raw.push(...cfg.userKeywords);

	// Both keyword lists are read-only snapshots, so false positives are removed
	// via the whitelist, which applies to all three sources.
	const whitelist = buildWhitelistIndex(cfg.whitelist, cfg);

	const plain: string[] = [];
	const seenPlain = new Set<string>();
	const seenRegex = new Set<string>();
	const custom: { source: string; re: RegExp }[] = [];

	for (const item of raw) {
		const kw = String(item || "").trim();
		if (!kw || whitelist.has(kw)) continue;

		const asRegexMatch = asRegex(kw);
		if (asRegexMatch) {
			if (seenRegex.has(kw)) continue;
			try {
				// /regex/flags: keep the regex's own case/whitespace semantics,
				// strip stateful g/y flags.
				const flags = asRegexMatch[2].replace(/[gy]/gi, "");
				custom.push({ source: kw, re: new RegExp(asRegexMatch[1], flags) });
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
	};
}

/** Return the matched keyword string, or null if nothing matched. */
export function matchAny(matchers: Matchers, text: string): string | null {
	if (!text || matchers.count === 0) return null;

	// Plain keywords: match against normalized text.
	const plainText = normalizeKeyword(text, matchers.normalization);
	if (plainText) {
		for (const re of matchers.plain) {
			const match = re.exec(plainText);
			if (match) return match[0];
		}
	}

	// Custom regexes: keep the raw text's spaces/newlines/case, only strip
	// zero-width and direction-control chars.
	const regexText = text.replace(
		/[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]+/g,
		"",
	);
	for (const c of matchers.custom) {
		if (c.re.test(regexText)) return c.source;
	}
	return null;
}

function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
