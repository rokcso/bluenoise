/**
 * Frame-budgeted draining of a work queue.
 *
 * X can emit hundreds of mutations in one frame. Evaluating everything in that
 * frame blocks the page, so the scan loop stops on either a time budget or an
 * item cap and puts the rest back for the next frame. The rule that matters:
 * always make progress on at least one item, even if a single item is more
 * expensive than the whole budget.
 */

/**
 * Why a scan was queued. Kept as a closed union so the debug log stays
 * greppable: every value here is a real code path, never a free-form string.
 */
export type ScanTrigger =
	| "initial"
	| "navigation"
	| "pageshow"
	| "mutation"
	| "mutation-burst"
	| "visibility"
	| "config-change"
	| "rules-change"
	| "account-list-change"
	| "debug-enabled"
	| "continuation";

export interface DrainOptions<T> {
	/** Wall-clock budget in ms; measured with `now`. */
	budgetMs: number;
	/** Hard cap on items per frame. */
	maxItems: number;
	/** Monotonic clock, defaults to performance.now. */
	now?: () => number;
	/**
	 * Process one item. Return `false` to stop the batch immediately (used when
	 * the extension context died mid-scan and nothing else should run); anything
	 * else, including `undefined`, means "carry on".
	 */
	process(item: T): boolean | undefined;
}

export interface DrainResult<T> {
	/** Items actually processed this frame. */
	processed: number;
	/** Items not processed and still owed a pass, in their original order. */
	remaining: T[];
	/** True when the batch stopped because of the budget, not the queue length. */
	budgetExhausted: boolean;
	/** True when `process` asked to stop. */
	aborted: boolean;
}

/** Drain `queue` in place-safe fashion: the input is not mutated. */
export function drainWithinBudget<T>(
	queue: readonly T[],
	options: DrainOptions<T>,
): DrainResult<T> {
	const now = options.now ?? (() => performance.now());
	const startedAt = now();
	let processed = 0;
	for (let index = 0; index < queue.length; index++) {
		if (options.process(queue[index]) === false)
			return {
				processed,
				remaining: queue.slice(index + 1),
				budgetExhausted: false,
				aborted: true,
			};
		processed++;
		// Always make progress on at least one item, even if one unusually
		// expensive item consumes the whole budget by itself.
		if (
			processed >= options.maxItems ||
			(processed > 0 && now() - startedAt >= options.budgetMs)
		) {
			return {
				processed,
				remaining: queue.slice(index + 1),
				budgetExhausted: index + 1 < queue.length,
				aborted: false,
			};
		}
	}
	return { processed, remaining: [], budgetExhausted: false, aborted: false };
}
