/**
 * Pure half of the experimental Jev second pass.
 *
 * Everything here runs without `chrome.*` so the request shape, the response
 * parser, and the confidence gate can be unit-tested. The IO lives in the
 * background worker; the DOM lives in the content script.
 *
 * The design mirrors how the rule engine already works: Jev is a fourth
 * *source* alongside keyword / account / preset rules, and its verdict is
 * turned into an ordinary filter hit that the existing presentation pipeline
 * renders. It never gets to decide *how* a match is displayed.
 */

import {
	AI_PROVIDER,
	type AiCache,
	type AiCandidate,
} from "@/src/contracts/ai";

/** P(reply is noise) at or above this filters the reply. */
export const AI_NOISE_THRESHOLD = 0.9;
/** Questions per request. Jev evaluates every question in one parallel pass. */
export const AI_MAX_BATCH = 25;
/** Per-reply character budget. Replies are short; this only bounds the absurd. */
export const AI_TEXT_LIMIT = 400;
/** Budget for the post under discussion, the context a keyword rule cannot see. */
export const AI_PARENT_LIMIT = 800;
/** Verdicts older than this are re-asked rather than trusted forever. */
export const AI_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Upper bound on stored verdicts so `storage.local` cannot grow without end. */
export const AI_CACHE_MAX_ENTRIES = 2000;
/** Suffix that turns a request-scoped reply id into its question key. */
export const AI_QUESTION_SUFFIX = "_noise";

const INVISIBLE_CHARS_RE =
	/[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;

export function truncate(text: string, limit: number): string {
	const trimmed = text.trim().replace(/\s+/g, " ");
	return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`;
}

/** FNV-1a over the normalized text; two seeds keep collisions negligible. */
function fnv1a(text: string, seed: number): number {
	let hash = seed;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

/**
 * Cache key for one reply. Lives in the content script, so it must be a
 * function of the text alone — and normalization means a reply that only
 * differs in whitespace or case reuses the verdict it already paid for.
 */
export function aiFingerprint(text: string): string {
	const normalized = text
		.toLowerCase()
		.replace(INVISIBLE_CHARS_RE, "")
		.replace(/\s+/g, " ")
		.trim();
	return `${normalized.length.toString(36)}-${fnv1a(normalized, 0x811c9dc5).toString(36)}${fnv1a(normalized, 0x01000193).toString(36)}`;
}

/**
 * One atomic question per reply. Asking a single "is this noise" question and
 * keeping the routing decision in code is deliberate: it matches the project's
 * existing one-rule-one-reason model and keeps the model out of the controls.
 */
function noiseInstructions(id: string): string {
	return (
		`Reply "${id}" in the "replies" list. ` +
		"Answer true if it is conversational noise: spam, advertising or promotion, " +
		"engagement bait, a link or follow solicitation, content-free praise or banter, " +
		"or text that adds nothing to the discussion. " +
		"Answer false if it makes a genuine point, asks or answers a question, " +
		"or shares information or an opinion."
	);
}

export function aiQuestionKey(id: string): string {
	return `${id}${AI_QUESTION_SUFFIX}`;
}

/**
 * Build the `POST /v1/systemone` body. The thread is sent as structured state
 * so one call can judge every loaded reply, which is both cheaper than one
 * call per reply and gives the model the context it needs.
 */
export function buildAiRequest(
	parent: string,
	items: AiCandidate[],
): Record<string, unknown> {
	return {
		model: AI_PROVIDER.model,
		state: {
			parent_post: parent ? truncate(parent, AI_PARENT_LIMIT) : null,
			replies: items.map((item) => ({
				id: item.id,
				author: item.author,
				text: truncate(item.text, AI_TEXT_LIMIT),
			})),
		},
		questions: Object.fromEntries(
			items.map((item) => [
				aiQuestionKey(item.id),
				{ type: "noul", instructions: noiseInstructions(item.id) },
			]),
		),
	};
}

/**
 * Read `answers` back into `id -> P(noise)`. Returns null when the payload is
 * not a System One response at all, so the caller can tell "nothing usable"
 * apart from "everything came back negative".
 */
export function parseAiResponse(
	payload: unknown,
	items: AiCandidate[],
): Record<string, number> | null {
	const answers = (payload as { answers?: unknown } | null)?.answers;
	if (!answers || typeof answers !== "object") return null;
	const wanted = new Set(items.map((item) => item.id));
	const probabilities: Record<string, number> = {};
	for (const [key, value] of Object.entries(
		answers as Record<string, unknown>,
	)) {
		if (!key.endsWith(AI_QUESTION_SUFFIX)) continue;
		const id = key.slice(0, -AI_QUESTION_SUFFIX.length);
		if (!wanted.has(id)) continue;
		const noul = (value as { noul?: unknown } | null)?.noul;
		if (typeof noul !== "number" || !Number.isFinite(noul)) continue;
		probabilities[id] = Math.min(1, Math.max(0, noul));
	}
	return probabilities;
}

/** The confidence gate. Below the threshold Jev's opinion is simply dropped. */
export function shouldFilter(probability: number): boolean {
	return probability >= AI_NOISE_THRESHOLD;
}

export function readCachedProbability(
	cache: AiCache,
	key: string,
	now: number,
): number | null {
	const entry = cache[key];
	if (!entry) return null;
	if (now - entry.at > AI_CACHE_TTL_MS) return null;
	return entry.probability;
}

/** Insert a verdict, dropping the oldest entries once the cache is at its cap. */
export function withCachedVerdict(
	cache: AiCache,
	key: string,
	probability: number,
	now: number,
): AiCache {
	const next: AiCache = { ...cache, [key]: { probability, at: now } };
	const keys = Object.keys(next);
	if (keys.length <= AI_CACHE_MAX_ENTRIES) return next;
	const oldest = keys.sort((a, b) => next[a].at - next[b].at);
	for (const stale of oldest.slice(0, keys.length - AI_CACHE_MAX_ENTRIES)) {
		delete next[stale];
	}
	return next;
}
