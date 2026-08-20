import { parseKeywordText } from "@/src/domain/normalize";

/** Download and validate a remote keyword source. On failure, the caller keeps the existing local copy. */
export async function fetchKeywordSource(source: {
	name: string;
	url: string;
}): Promise<string[]> {
	const response = await fetch(source.url, { cache: "no-store" });
	if (!response.ok) {
		throw new Error(`${source.name} request failed: HTTP ${response.status}`);
	}

	const text = await response.text();
	if (text.length > 2 * 1024 * 1024) {
		throw new Error(`${source.name} exceeds 2 MB, import rejected`);
	}
	if (/^\s*<(?:!doctype|html)\b/i.test(text)) {
		throw new Error("Remote address returned HTML instead of keywords.txt");
	}

	const keywords = parseKeywordText(text);
	if (keywords.length === 0) {
		throw new Error(`${source.name} is empty`);
	}

	return keywords;
}
