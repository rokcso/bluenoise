/**
 * Types for the behavior source: a reply-farm detector that needs no model.
 *
 * The signals come from what the DOM already tells us — the author handle, the
 * thread a reply belongs to, and the status id, which encodes its exact post
 * time. Nothing here calls the network or reads the user's account.
 *
 * History lives in `storage.local`: it describes accounts, not content, and it
 * expires, so it must not sync to the browser account or ride along in a rules
 * export.
 */

/** Storage key for the per-account reply history. */
export const BEHAVIOR_HISTORY_KEY = "behavior-history";

/** One reply we have seen. Times are epoch milliseconds. */
export interface ReplyRecord {
	/** Post time, derived from the status id. */
	at: number;
	/** Thread the reply belongs to; `TIMELINE_PARENT` outside a thread. */
	parent: string;
	text: string;
}

/** Marker for tweets that are not replies to an opened thread. */
export const TIMELINE_PARENT = "timeline";

export type BehaviorHistory = Record<string, ReplyRecord[]>;

/**
 * Age out an account entirely. A farm stops being interesting once it has been
 * quiet this long, and unbounded history would be both a privacy and a storage
 * problem.
 */
export const BEHAVIOR_TTL_MS = 24 * 60 * 60 * 1000;
/** Accounts kept at once (most recently seen win). */
export const BEHAVIOR_MAX_ACCOUNTS = 500;
/** Replies kept per account; enough for every rule, far from unbounded. */
export const BEHAVIOR_MAX_REPLIES = 30;

function isRecord(value: unknown): value is ReplyRecord {
	const entry = value as Partial<ReplyRecord> | undefined;
	return (
		typeof entry?.at === "number" &&
		Number.isFinite(entry.at) &&
		entry.at > 0 &&
		typeof entry.parent === "string" &&
		typeof entry.text === "string"
	);
}

/** Normalize whatever is stored: drop junk, enforce the caps, age out old entries. */
export function parseBehaviorHistory(
	value: unknown,
	now = Date.now(),
): BehaviorHistory {
	if (!value || typeof value !== "object") return {};
	const history: BehaviorHistory = {};
	for (const [handle, entries] of Object.entries(
		value as Record<string, unknown>,
	)) {
		if (!handle || !Array.isArray(entries)) continue;
		const recent = entries
			.filter(isRecord)
			.filter((entry) => now - entry.at <= BEHAVIOR_TTL_MS)
			.sort((a, b) => a.at - b.at)
			.slice(-BEHAVIOR_MAX_REPLIES);
		if (recent.length) history[handle] = recent;
	}
	return history;
}

/** Keep the account map bounded by dropping the least recently seen accounts. */
export function capBehaviorHistory(history: BehaviorHistory): BehaviorHistory {
	const handles = Object.keys(history);
	if (handles.length <= BEHAVIOR_MAX_ACCOUNTS) return history;
	const keep = handles
		.sort((a, b) => {
			const lastA = history[a]?.at(-1)?.at ?? 0;
			const lastB = history[b]?.at(-1)?.at ?? 0;
			return lastB - lastA;
		})
		.slice(0, BEHAVIOR_MAX_ACCOUNTS);
	const capped: BehaviorHistory = {};
	for (const handle of keep) {
		const entries = history[handle];
		if (entries) capped[handle] = entries;
	}
	return capped;
}
