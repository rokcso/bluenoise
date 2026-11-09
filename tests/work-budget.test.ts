import { describe, expect, it, vi } from "vitest";
import { drainWithinBudget } from "@/src/content/work-budget";

/** A clock the test advances by hand. */
function clock() {
	let time = 0;
	return {
		now: () => time,
		advance(ms: number) {
			time += ms;
		},
	};
}

describe("drainWithinBudget", () => {
	it("processes everything when the queue fits", () => {
		const seen: number[] = [];
		const result = drainWithinBudget([1, 2, 3], {
			budgetMs: 8,
			maxItems: 50,
			now: () => 0,
			process: (item) => {
				seen.push(item);
				return true;
			},
		});

		expect(seen).toEqual([1, 2, 3]);
		expect(result.processed).toBe(3);
		expect(result.remaining).toEqual([]);
		expect(result.budgetExhausted).toBe(false);
	});

	it("stops at the item cap and hands the rest back in order", () => {
		const seen: number[] = [];
		const result = drainWithinBudget([1, 2, 3, 4, 5], {
			budgetMs: 1000,
			maxItems: 2,
			now: () => 0,
			process: (item) => {
				seen.push(item);
				return true;
			},
		});

		expect(seen).toEqual([1, 2]);
		expect(result.remaining).toEqual([3, 4, 5]);
		expect(result.budgetExhausted).toBe(true);
	});

	it("stops when the time budget runs out", () => {
		const time = clock();
		const seen: number[] = [];
		const result = drainWithinBudget([1, 2, 3, 4], {
			budgetMs: 8,
			maxItems: 50,
			now: time.now,
			process: (item) => {
				seen.push(item);
				time.advance(5);
				return true;
			},
		});

		// Two items cost 10 ms, crossing the 8 ms budget.
		expect(seen).toEqual([1, 2]);
		expect(result.remaining).toEqual([3, 4]);
	});

	it("always makes progress on at least one item", () => {
		const time = clock();
		const result = drainWithinBudget(["expensive", "more"], {
			budgetMs: 8,
			maxItems: 50,
			now: time.now,
			process: () => {
				// One single item blows the whole budget.
				time.advance(500);
				return true;
			},
		});

		expect(result.processed).toBe(1);
		expect(result.remaining).toEqual(["more"]);
	});

	it("stops immediately when processing asks to abort", () => {
		const seen: number[] = [];
		const result = drainWithinBudget([1, 2, 3], {
			budgetMs: 100,
			maxItems: 50,
			now: () => 0,
			process: (item) => {
				seen.push(item);
				return item !== 2;
			},
		});

		expect(seen).toEqual([1, 2]);
		expect(result.aborted).toBe(true);
		expect(result.remaining).toEqual([3]);
	});

	it("is an empty no-op for an empty queue", () => {
		const process = vi.fn(() => true);
		const result = drainWithinBudget([], {
			budgetMs: 8,
			maxItems: 50,
			process,
		});

		expect(process).not.toHaveBeenCalled();
		expect(result).toEqual({
			processed: 0,
			remaining: [],
			budgetExhausted: false,
			aborted: false,
		});
	});

	it("does not mutate the queue it was given", () => {
		const queue = [1, 2, 3];
		drainWithinBudget(queue, {
			budgetMs: 8,
			maxItems: 1,
			now: () => 0,
			process: () => true,
		});

		expect(queue).toEqual([1, 2, 3]);
	});
});
