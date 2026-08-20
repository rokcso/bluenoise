/**
 * Read the immutable numeric X user id from React internals.
 *
 * X does not expose the numeric user id in the DOM (there is no
 * `data-user-id` attribute), so the DOM is only good for the mutable @handle.
 * The React fiber attached to each element carries the user record
 * (`rest_id` / `legacy.id_str`). Matching by this immutable id is what keeps
 * account filtering working across @handle renames, mirroring MXGA's own
 * extension.
 *
 * This walks a bounded, budgeted subtree so it can never hang the page.
 */

const FIBER_KEY_PREFIX = "__reactFiber$";
/** Hard cap on visited objects while searching for the User node. */
const FIBER_WALK_BUDGET = 4000;
/** How many `.return` ancestor hops to try before giving up. */
const FIBER_MAX_ANCESTORS = 24;
/** Recursion depth into each props/state bag. */
const FIBER_MAX_DEPTH = 5;

function numericId(value: unknown): string | undefined {
	return typeof value === "string" && /^\d+$/.test(value) ? value : undefined;
}

function normalizeScreenName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return value.trim().replace(/^@+/, "").toLowerCase();
}

/** True for DOM/Window objects, which we must never recurse into. Guarded
 *  so the module also works in a bare Node test env where Node/Window may be
 *  undefined (avoids `instanceof undefined` throwing). */
function isDomNode(value: unknown): boolean {
	return (
		(typeof Node !== "undefined" && value instanceof Node) ||
		(typeof Window !== "undefined" && value instanceof Window)
	);
}

/**
 * Depth-first search for a `__typename === "User"` React node, optionally
 * constrained to a specific @handle. Returns the User node or null.
 */
function findUserNode(
	value: unknown,
	seen: Set<object>,
	depth: number,
	budget: { n: number },
	expectedHandle: string | undefined,
	// biome-ignore lint/suspicious/noExplicitAny: React internals are untyped
): any {
	if (!value || typeof value !== "object" || depth > FIBER_MAX_DEPTH)
		return null;
	if (seen.has(value)) return null;
	if (--budget.n <= 0) return null; // global work budget — never hang the page
	if (isDomNode(value)) return null;
	seen.add(value);
	try {
		const legacy = (value as Record<string, unknown>).legacy ?? value;
		if (
			(value as Record<string, unknown>).__typename === "User" &&
			legacy &&
			typeof legacy === "object" &&
			("followers_count" in legacy || "screen_name" in legacy)
		) {
			const screenName = normalizeScreenName(
				(legacy as Record<string, unknown>).screen_name,
			);
			if (!expectedHandle || !screenName || screenName === expectedHandle) {
				return value;
			}
		}
		for (const key of Object.keys(value)) {
			const found = findUserNode(
				(value as Record<string, unknown>)[key],
				seen,
				depth + 1,
				budget,
				expectedHandle,
			);
			if (found) return found;
		}
	} catch {
		/* a getter threw — skip this branch */
	}
	return null;
}

/**
 * Extract the numeric user id for the account whose tweet lives at `el`.
 * `expectedHandle` (optional) disambiguates which User node to pick.
 */
export function readFiberUserId(
	el: Element,
	expectedHandle?: string,
): string | undefined {
	try {
		const fiberKey = Object.keys(el).find((k) =>
			k.startsWith(FIBER_KEY_PREFIX),
		);
		if (!fiberKey) return undefined;
		const want = normalizeScreenName(expectedHandle);
		// biome-ignore lint/suspicious/noExplicitAny: React internals are untyped
		let node: any = (el as unknown as Record<string, unknown>)[fiberKey];
		const seen = new Set<object>();
		const budget = { n: FIBER_WALK_BUDGET };
		for (let i = 0; node && i < FIBER_MAX_ANCESTORS; i++) {
			for (const bag of [node.memoizedProps, node.memoizedState]) {
				const user = findUserNode(bag, seen, 0, budget, want);
				if (user) {
					const restId = numericId(user.rest_id);
					const legacy = (user.legacy ?? user) as Record<string, unknown>;
					return restId ?? numericId(legacy.id_str);
				}
			}
			node = node.return;
		}
	} catch {
		/* X internals changed → graceful empty */
	}
	return undefined;
}
