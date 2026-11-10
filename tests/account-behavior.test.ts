import { describe, expect, it } from "vitest";
import {
	BEHAVIOR_MAX_REPLIES,
	BEHAVIOR_TTL_MS,
	capBehaviorHistory,
	parseBehaviorHistory,
	type ReplyRecord,
	TIMELINE_PARENT,
} from "@/src/contracts/behavior";
import {
	BEHAVIOR_THRESHOLD,
	evaluateBehavior,
	openingKey,
	recordReply,
	shouldFilterBehavior,
	weightedLength,
} from "@/src/domain/account-behavior";
import { postedAtFromStatusId } from "@/src/domain/snowflake";

const T0 = Date.UTC(2026, 0, 15, 6, 0, 0); // 06:00 UTC: midday in +08, not night.

function reply(
	at: number,
	parent: string,
	text = "一段普通的回复内容",
): ReplyRecord {
	return { at, parent, text };
}

/** A burst: one reply every 10 seconds, each in a different thread. */
function burst(count: number, gapMs = 10_000, start = T0): ReplyRecord[] {
	return Array.from({ length: count }, (_, index) =>
		reply(
			start + index * gapMs,
			`parent-${index}`,
			`很不错的观点，我也这么觉得${index}`,
		),
	);
}

describe("snowflake post times", () => {
	it("decodes the exact post time from a status id", () => {
		// Real id from the reference sheet, posted 2026-10-18 01:08 UTC.
		const at = postedAtFromStatusId("2111625358101635562");
		expect(at).toBe(Date.UTC(2026, 9, 18, 1, 8, 12, 130));
	});

	it("rejects ids that are not snowflakes", () => {
		expect(postedAtFromStatusId(null)).toBeNull();
		expect(postedAtFromStatusId("")).toBeNull();
		expect(postedAtFromStatusId("not-a-number")).toBeNull();
		expect(postedAtFromStatusId("1")).toBeNull(); // before the epoch
	});
});

describe("reply-farm rules", () => {
	it("flags a burst across different threads", () => {
		const verdict = evaluateBehavior(burst(4));
		expect(verdict?.signals.map((s) => s.id)).toContain("burst");
		expect(shouldFilterBehavior(verdict)).toBe(true);
	});

	it("does not flag a chatty human in one thread", () => {
		// Same account, same speed, but every reply is in one conversation:
		// a lively back-and-forth looks identical in time and must not be flagged.
		const records = Array.from({ length: 6 }, (_, index) =>
			reply(T0 + index * 10_000, "one-thread", `回你第${index}句`),
		);
		const verdict = evaluateBehavior(records);
		expect(verdict?.signals.map((s) => s.id)).not.toContain("burst");
		expect(shouldFilterBehavior(verdict)).toBe(false);
	});

	it("does not flag a timeline of unrelated tweets", () => {
		// On the home timeline every record shares the marker parent, so the
		// distinct-thread evidence simply is not available.
		const records = Array.from({ length: 6 }, (_, index) =>
			reply(T0 + index * 10_000, TIMELINE_PARENT, `随手一条${index}`),
		);
		expect(
			evaluateBehavior(records)?.signals.map((s) => s.id) ?? [],
		).not.toContain("burst");
	});

	it("flags sustained volume and short cadence", () => {
		const records = Array.from({ length: 12 }, (_, index) =>
			reply(T0 + index * 15_000, `p-${index % 5}`, `工整短评${index}`),
		);
		const ids = evaluateBehavior(records)?.signals.map((s) => s.id) ?? [];
		expect(ids).toContain("flood");
		expect(ids).toContain("cadence");
	});

	it("flags a machine-regular cadence", () => {
		// Exactly 61s apart, twelve times: a scheduler, not a person.
		const records = Array.from({ length: 12 }, (_, index) =>
			reply(T0 + index * 61_000, `p-${index}`, `同一句点评内容${index}`),
		);
		expect(evaluateBehavior(records)?.signals.map((s) => s.id) ?? []).toContain(
			"regular",
		);
	});

	it("does not flag irregular human timing", () => {
		const gaps = [3_000, 400_000, 12_000, 900_000, 40_000, 660_000, 5_000];
		let at = T0;
		const records = gaps.map((gap, index) => {
			at += gap;
			return reply(at, `p-${index}`, `有时候回一句，隔很久再来一句${index}`);
		});
		const ids = evaluateBehavior(records)?.signals.map((s) => s.id) ?? [];
		expect(ids).not.toContain("regular");
	});

	it("flags the same opening line across threads", () => {
		const records = Array.from({ length: 3 }, (_, index) =>
			reply(
				T0 + index * 3_600_000,
				`p-${index}`,
				`补充一个容易忽略的点：${index} 号细节`,
			),
		);
		expect(evaluateBehavior(records)?.signals.map((s) => s.id) ?? []).toContain(
			"opening",
		);
	});

	it("flags a phrase lifted into several replies", () => {
		const shared = "我们做 Luci Desktop 就是补这块，后台记下屏幕上做过的事";
		const records = Array.from({ length: 3 }, (_, index) =>
			reply(T0 + index * 3_600_000, `p-${index}`, `${shared}（${index}）`),
		);
		expect(evaluateBehavior(records)?.signals.map((s) => s.id) ?? []).toContain(
			"phrase",
		);
	});

	it("flags text cut off at the length ceiling", () => {
		// ~140 CJK characters weighs 280: the platform ceiling, stopped mid-clause.
		const text = "这".repeat(139);
		const records = [
			reply(T0, "p-1", text),
			reply(T0 + 3_600_000, "p-2", text),
		];
		expect(evaluateBehavior(records)?.signals.map((s) => s.id) ?? []).toContain(
			"truncated",
		);
	});

	it("returns null with no history", () => {
		expect(evaluateBehavior([])).toBeNull();
	});

	it("keeps the score under one and gates on the threshold", () => {
		const verdict = evaluateBehavior(burst(8, 5_000));
		expect(verdict?.score).toBeLessThanOrEqual(1);
		expect(verdict && verdict.score >= BEHAVIOR_THRESHOLD).toBe(true);
	});
});

describe("history bookkeeping", () => {
	it("replaces a re-rendered reply instead of double counting it", () => {
		let history = recordReply({}, "Alice", reply(T0, "p-1"));
		history = recordReply(history, "alice", reply(T0, "p-1"));
		expect(history.alice).toHaveLength(1);
	});

	it("keeps only the newest replies per account", () => {
		let history = {};
		for (let index = 0; index < BEHAVIOR_MAX_REPLIES + 10; index++) {
			history = recordReply(
				history,
				"bob",
				reply(T0 + index * 1000, `p-${index}`),
			);
		}
		expect((history as Record<string, ReplyRecord[]>).bob).toHaveLength(
			BEHAVIOR_MAX_REPLIES,
		);
	});

	it("drops entries older than the TTL", () => {
		const stale = reply(T0 - BEHAVIOR_TTL_MS - 1000, "p-0");
		const fresh = reply(T0, "p-1");
		expect(parseBehaviorHistory({ carol: [stale, fresh] }, T0).carol).toEqual([
			fresh,
		]);
	});

	it("caps how many accounts are kept", () => {
		const history: Record<string, ReplyRecord[]> = {};
		for (let index = 0; index < 600; index++) {
			history[`u${index}`] = [reply(T0 + index, `p-${index}`)];
		}
		expect(Object.keys(capBehaviorHistory(history))).toHaveLength(500);
		// The most recently seen accounts survive.
		expect(Object.keys(capBehaviorHistory(history))).toContain("u599");
	});

	it("ignores junk when loading storage", () => {
		expect(parseBehaviorHistory("nonsense", T0)).toEqual({});
		expect(parseBehaviorHistory({ x: "nope" }, T0)).toEqual({});
		expect(parseBehaviorHistory({ x: [{ at: "1" }] }, T0)).toEqual({});
	});
});

describe("helpers", () => {
	it("weighs CJK characters as two", () => {
		expect(weightedLength("abc")).toBe(3);
		expect(weightedLength("中文")).toBe(4);
	});

	it("normalizes an opening line despite punctuation and emoji", () => {
		expect(openingKey("说真的，这个观点很好")).toBe("说真的，");
		expect(openingKey("😂 说真的，这个观点很好")).toBe("说真的，");
		expect(openingKey("   ")).toBeNull();
	});
});
