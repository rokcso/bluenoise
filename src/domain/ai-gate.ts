/**
 * Pure half of the Jev quota guard.
 *
 * The feature spends the user's own money, so it needs two brakes that no
 * setting exposes: a rolling window that caps how many requests one stretch of
 * browsing may fire, and a cooldown that stops hammering a provider which just
 * said no. Both live in the background worker and are persisted, because a
 * suspended service worker must not forget them.
 *
 * Everything here is a pure function of `(gate, now)` so the policy is unit
 * tested against a fake clock instead of real waiting.
 */

import type { AiGate } from "@/src/contracts/ai";

/** Requests allowed inside one window. */
export const AI_WINDOW_MAX_REQUESTS = 40;
/** Length of the rolling window. */
export const AI_WINDOW_MS = 10 * 60 * 1000;
/**
 * A rejected key does not start working on its own, so park the feature for a
 * long while instead of re-sending the same credential on every scan.
 */
export const AI_COOLDOWN_AUTH_MS = 30 * 60 * 1000;
/** First step of the exponential backoff used for 5xx and network failures. */
export const AI_COOLDOWN_BASE_MS = 30 * 1000;
/** Ceiling for any cooldown, including one the provider asked for. */
export const AI_COOLDOWN_MAX_MS = 60 * 60 * 1000;

/** How the provider failed, which decides how long we wait. */
export type AiFailureKind = "auth" | "rate-limit" | "server" | "network";

/** Why a request was refused before it cost anything. */
export type AiGateBlock = "cooling-down" | "budget-exceeded";

export function emptyGate(): AiGate {
	return { window: [], cooldownUntil: 0, failures: 0 };
}

/** Drop spent requests that have aged out of the window. */
function prune(window: number[], now: number): number[] {
	return window.filter((at) => now - at < AI_WINDOW_MS);
}

/** Map an HTTP status onto the cooldown policy; `null` means the fetch threw. */
export function classifyFailure(status: number | null): AiFailureKind {
	if (status === null) return "network";
	if (status === 401 || status === 403) return "auth";
	if (status === 429) return "rate-limit";
	return "server";
}

/**
 * Read a `Retry-After` header (delta seconds or an HTTP date) as milliseconds.
 * Returns null when the header is absent or unparseable.
 */
export function parseRetryAfter(
	header: string | null,
	now: number,
): number | null {
	if (!header) return null;
	const trimmed = header.trim();
	if (!trimmed) return null;
	const seconds = Number(trimmed);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const date = Date.parse(trimmed);
	if (Number.isNaN(date)) return null;
	return Math.max(0, date - now);
}

/** The gate's verdict for a request that has not been sent yet. */
export function gateBlock(gate: AiGate, now: number): AiGateBlock | null {
	if (gate.cooldownUntil > now) return "cooling-down";
	if (prune(gate.window, now).length >= AI_WINDOW_MAX_REQUESTS)
		return "budget-exceeded";
	return null;
}

/** Spend one request: remember when it started so the window can count it. */
export function recordRequest(gate: AiGate, now: number): AiGate {
	return { ...gate, window: [...prune(gate.window, now), now] };
}

/** A proven-good key clears both brakes. */
export function recordSuccess(gate: AiGate, now: number): AiGate {
	return clampWindow({ ...gate, cooldownUntil: 0, failures: 0 }, now);
}

/**
 * Back off after a failure. Auth failures get a fixed long cooldown; everything
 * else doubles from a short first step, and a provider-sent `Retry-After` wins
 * over our own guess.
 */
export function recordFailure(
	gate: AiGate,
	kind: AiFailureKind,
	retryAfterMs: number | null,
	now: number,
): AiGate {
	const backoff = AI_COOLDOWN_BASE_MS * 2 ** Math.min(gate.failures, 16);
	const wait =
		kind === "auth"
			? AI_COOLDOWN_AUTH_MS
			: kind === "rate-limit" && retryAfterMs !== null
				? retryAfterMs
				: backoff;
	return clampWindow(
		{
			...gate,
			cooldownUntil: now + Math.min(Math.max(wait, 0), AI_COOLDOWN_MAX_MS),
			failures: gate.failures + 1,
		},
		now,
	);
}

function clampWindow(gate: AiGate, now: number): AiGate {
	return { ...gate, window: prune(gate.window, now) };
}
