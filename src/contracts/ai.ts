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

/** The provider the extension ships with; also the migration target for old data. */
export const AI_DEFAULT_PROVIDER_ID = "typesafe";

export interface AiSecrets {
	/** Key material, partitioned by provider id. Never leaves `storage.local`. */
	byProvider: Record<string, { apiKey: string }>;
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
	const stored = value as
		| (Partial<AiSecrets> & { apiKey?: unknown })
		| undefined;
	// Shape before the provider registry: a single key that belonged to the
	// built-in provider. Keep reading it so an upgrade never asks for it again.
	if (typeof stored?.apiKey === "string") {
		const legacy = stored.apiKey.trim();
		return {
			byProvider: legacy
				? { [AI_DEFAULT_PROVIDER_ID]: { apiKey: legacy } }
				: {},
		};
	}
	const byProvider: AiSecrets["byProvider"] = {};
	const entries = stored?.byProvider;
	if (entries && typeof entries === "object") {
		for (const [id, entry] of Object.entries(
			entries as Record<string, { apiKey?: unknown } | undefined>,
		)) {
			if (!id || typeof entry?.apiKey !== "string") continue;
			const apiKey = entry.apiKey.trim();
			if (apiKey) byProvider[id] = { apiKey };
		}
	}
	return { byProvider };
}

/** The key for one provider, or "" when it has none. */
export function aiKeyFor(secrets: AiSecrets, providerId: string): string {
	return secrets.byProvider[providerId]?.apiKey ?? "";
}

/**
 * Verdict caches and quota guards are keyed by provider: a verdict is a
 * property of the model that produced it, and rate limits belong to whoever
 * issued the key. Sharing either across providers would be wrong, not just slow.
 */
export type AiCacheMap = Record<string, AiCache>;
export type AiGateMap = Record<string, AiGate>;

function looksLikeVerdict(value: unknown): boolean {
	const entry = value as Partial<AiVerdict> | undefined;
	return typeof entry?.probability === "number" && typeof entry.at === "number";
}

export function parseAiCacheMap(value: unknown): AiCacheMap {
	const stored = value as Record<string, unknown> | undefined;
	if (!stored || typeof stored !== "object") return {};
	const entries = Object.values(stored);
	// Unpartitioned shape: one flat cache, produced by the built-in provider.
	if (entries.length && entries.every(looksLikeVerdict)) {
		return { [AI_DEFAULT_PROVIDER_ID]: parseAiCache(stored) };
	}
	const map: AiCacheMap = {};
	for (const [id, cache] of Object.entries(stored)) {
		if (id) map[id] = parseAiCache(cache);
	}
	return map;
}

export function parseAiGateMap(value: unknown): AiGateMap {
	const stored = value as Record<string, unknown> | undefined;
	if (!stored || typeof stored !== "object") return {};
	if (Array.isArray(stored.window)) {
		return { [AI_DEFAULT_PROVIDER_ID]: parseAiGate(stored) };
	}
	const map: AiGateMap = {};
	for (const [id, gate] of Object.entries(stored)) {
		if (id) map[id] = parseAiGate(gate);
	}
	return map;
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
