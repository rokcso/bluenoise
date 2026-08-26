import {
	IGNORABLE_SRC,
	INVISIBLE_ONE_RE,
	REGEX_ESCAPE_RE,
	SPACE_AND_INVISIBLE_RE,
} from "@/src/contracts/config";

/** `/regex/flags` form? Returns the match ([1] = regex body, [2] = flags) or null. */
export function asRegex(keyword: string): RegExpMatchArray | null {
	return String(keyword || "").match(/^\/(.+)\/([a-zA-Z]*)$/);
}

/**
 * Normalize a plain keyword or body text.
 * The content script uses it to decide matches; the settings panel uses it to
 * decide whether a word is already whitelisted — it must be the same rules,
 * otherwise the panel shows "whitelisted" while the rule is still blocking.
 */
export function normalizeKeyword(
	text: string,
	config: { caseSensitive?: boolean; ignoreSpaces?: boolean },
): string {
	let normalized = String(text || "");
	if (!config?.caseSensitive) normalized = normalized.toLowerCase();
	if (config?.ignoreSpaces !== false) {
		normalized = normalized.replace(SPACE_AND_INVISIBLE_RE, "");
	}
	return normalized;
}

/** Are two rules the same? (regex compare by raw text, plain words by normalized form.) */
export function sameKeyword(
	a: string,
	b: string,
	config: { caseSensitive?: boolean; ignoreSpaces?: boolean },
): boolean {
	const aRegex = asRegex(a);
	const bRegex = asRegex(b);
	if (aRegex || bRegex) return String(a).trim() === String(b).trim();
	return normalizeKeyword(a, config) === normalizeKeyword(b, config);
}

/**
 * Build the whitelist into two lookup sets: plain words keyed by normalized
 * form, regexes by raw text. A list can be hundreds of entries, so an includes()
 * scan would be too slow — build Sets instead.
 */
export interface WhitelistIndex {
	size: number;
	has(keyword: string): boolean;
}

export function buildWhitelistIndex(
	whitelist: string[] | undefined,
	config: { caseSensitive?: boolean; ignoreSpaces?: boolean },
): WhitelistIndex {
	const plain = new Set<string>();
	const regex = new Set<string>();

	for (const item of whitelist ?? []) {
		const keyword = String(item || "").trim();
		if (!keyword) continue;
		if (asRegex(keyword)) {
			regex.add(keyword);
			continue;
		}
		const normalized = normalizeKeyword(keyword, config);
		if (normalized) plain.add(normalized);
	}

	return {
		size: plain.size + regex.size,
		has(keyword: string): boolean {
			const kw = String(keyword || "").trim();
			if (!kw) return false;
			return asRegex(kw)
				? regex.has(kw)
				: plain.has(normalizeKeyword(kw, config));
		},
	};
}

/** Convert one-keyword-per-line text into a de-duplicated rule list. */
export function parseKeywordText(text: string): string[] {
	const keywords: string[] = [];
	const seen = new Set<string>();

	for (const line of String(text || "").split(/\r?\n/)) {
		const keyword = line.trim();
		if (!keyword || keyword.startsWith("#") || seen.has(keyword)) continue;
		seen.add(keyword);
		keywords.push(keyword);
	}

	return keywords;
}

/** Escape regex metacharacters in a plain keyword. */
export function escapeRegExp(str: string): string {
	return str.replace(REGEX_ESCAPE_RE, "\\$&");
}

/**
 * Build a "loose regex" from a matched keyword: each character may be separated
 * by any whitespace/zero-width chars, so we can still locate evasive forms like
 * "求主␣人" or "同 城" in the raw text. Pass undefined/null for a /regex/ hit.
 */
export function looseRegex(
	hit: string,
	config: { caseSensitive?: boolean; ignoreSpaces?: boolean },
): RegExp | null {
	const asRegexMatch = asRegex(hit);
	if (asRegexMatch) {
		// A /regex/ hit: use it directly against the raw text, with g to find all occurrences
		try {
			return new RegExp(
				asRegexMatch[1],
				`${asRegexMatch[2].replace(/[gy]/gi, "")}g`,
			);
		} catch {
			return null;
		}
	}

	const joiner = config.ignoreSpaces ? IGNORABLE_SRC : "";
	const body = Array.from(hit, (ch) => escapeRegExp(ch)).join(joiner);
	try {
		return new RegExp(body, config.caseSensitive ? "g" : "gi");
	} catch {
		return null;
	}
}

/** Remove zero-width / direction-control chars, returning an index map back to the original. */
export function stripInvisible(text: string): {
	stripped: string;
	map: number[];
} {
	let stripped = "";
	const map: number[] = [];
	for (let i = 0; i < text.length; i++) {
		if (INVISIBLE_ONE_RE.test(text[i])) continue;
		map.push(i);
		stripped += text[i];
	}
	return { stripped, map };
}
