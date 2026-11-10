/**
 * Post times from status ids.
 *
 * Every X status id is a snowflake: the high bits are a millisecond timestamp
 * offset from a fixed epoch. That means a reply's exact post time is already in
 * the page — no API call, no extra permission, no clock skew from the DOM's own
 * rendering. `hidden` in the DOM only gives a day or a second, and a farm is
 * visible precisely in the seconds.
 */

/** X's snowflake epoch (2010-11-04T01:42:54.657Z). */
export const SNOWFLAKE_EPOCH_MS = 1288834974657n;
/** Bits reserved for the machine/sequence half of the id. */
const SNOWFLAKE_NODE_SHIFT = 22n;

/**
 * Exact post time in epoch milliseconds, or null when the id is not a snowflake
 * (not a string of digits, or a value from before the epoch).
 */
export function postedAtFromStatusId(
	id: string | null | undefined,
): number | null {
	if (!id || !/^\d{1,25}$/.test(id)) return null;
	try {
		const shifted = BigInt(id) >> SNOWFLAKE_NODE_SHIFT;
		// An id below the node shift has no timestamp bits at all: it is a
		// truncated or fabricated value, not a post.
		if (shifted === 0n) return null;
		const at = Number(shifted + SNOWFLAKE_EPOCH_MS);
		if (!Number.isFinite(at) || at <= Number(SNOWFLAKE_EPOCH_MS)) return null;
		// Reject ids that claim to be from the future beyond any clock skew.
		if (at > Date.now() + 24 * 60 * 60 * 1000) return null;
		return at;
	} catch {
		return null;
	}
}
