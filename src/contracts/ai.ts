/**
 * Types for the experimental Jev second pass.
 *
 * The API key deliberately lives outside `AppConfig` / `RuleData`: settings
 * sync to the browser account and rule files are exported and shared, so a
 * credential stored there would leak. Everything here belongs in
 * `chrome.storage.local` and is never part of a rules export.
 */

/** Storage key for the user's own TypeSafe API key. Local only, never synced. */
export const AI_SECRETS_KEY = "ai-secrets";
/** Storage key for verdicts already paid for, keyed by reply fingerprint. */
export const AI_CACHE_KEY = "ai-filter-cache";
/** Storage key for the quota guard: rolling request window plus cooldown. */
export const AI_GATE_KEY = "ai-gate";

/** The provider this feature is built around. Metadata only; no key material. */
export const AI_PROVIDER = {
	id: "jev",
	name: "Jev",
	endpoint: "https://api.typesafe.ai/v1/systemone",
	model: "jev-latest",
	homepageUrl: "https://typesafe.ai/",
	docsUrl: "https://docs.typesafe.ai/introduction",
	keysUrl: "https://console.typesafe.ai/keys",
	/** Any origin the user must grant before the background worker may call it. */
	origin: "https://api.typesafe.ai/*",
} as const;

export interface AiSecrets {
	apiKey: string;
}

/** One cached verdict: P(reply is noise), plus when it was obtained. */
export interface AiVerdict {
	probability: number;
	at: number;
}

export type AiCache = Record<string, AiVerdict>;

/**
 * Quota guard state. It survives a suspended service worker on purpose: a
 * rejected key or a provider-mandated slowdown must not be forgotten between
 * batches, or every new request would pay for the same mistake.
 */
export interface AiGate {
	/** Timestamps of the requests already spent inside the rolling window. */
	window: number[];
	/** No request may start before this timestamp. */
	cooldownUntil: number;
	/** Consecutive 5xx / network failures; drives the exponential step. */
	failures: number;
}

/** A reply submitted for judgment. `id` is request-scoped and never persisted. */
export interface AiCandidate {
	id: string;
	author: string;
	text: string;
}

export interface AiEvaluateRequest {
	type: "BLUENOISE_AI_EVALUATE";
	/** Text of the post the replies belong to, when the page has one. */
	parent: string;
	items: AiCandidate[];
}

export interface AiEvaluateResponse {
	ok: boolean;
	/** Machine-readable failure code; the content script only logs it. */
	error?: string;
	/** Question id to P(noise), 0-1. Cached verdicts are included. */
	probabilities?: Record<string, number>;
}

export function parseAiSecrets(value: unknown): AiSecrets {
	const stored = value as Partial<AiSecrets> | undefined;
	return {
		apiKey: typeof stored?.apiKey === "string" ? stored.apiKey.trim() : "",
	};
}

export function parseAiCache(value: unknown): AiCache {
	if (!value || typeof value !== "object") return {};
	const cache: AiCache = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		const verdict = entry as Partial<AiVerdict> | undefined;
		if (
			typeof verdict?.probability === "number" &&
			Number.isFinite(verdict.probability) &&
			typeof verdict.at === "number"
		) {
			cache[key] = { probability: verdict.probability, at: verdict.at };
		}
	}
	return cache;
}

export function parseAiGate(value: unknown): AiGate {
	const stored = value as Partial<AiGate> | undefined;
	const window = Array.isArray(stored?.window)
		? stored.window.filter(
				(entry): entry is number => typeof entry === "number" && entry > 0,
			)
		: [];
	return {
		window,
		cooldownUntil:
			typeof stored?.cooldownUntil === "number" && stored.cooldownUntil > 0
				? stored.cooldownUntil
				: 0,
		failures:
			typeof stored?.failures === "number" && stored.failures > 0
				? Math.floor(stored.failures)
				: 0,
	};
}
