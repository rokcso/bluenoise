import { describe, expect, it } from "vitest";
import type { AiCandidate } from "@/src/contracts/ai";
import { parseAiCache, parseAiSecrets } from "@/src/contracts/ai";
import {
	AI_CACHE_MAX_ENTRIES,
	AI_CACHE_TTL_MS,
	AI_NOISE_THRESHOLD,
	aiFingerprint,
	aiQuestionKey,
	buildAiRequest,
	parseAiResponse,
	readCachedProbability,
	shouldFilter,
	truncate,
	withCachedVerdict,
} from "@/src/domain/ai-filter";

const items: AiCandidate[] = [
	{ id: "r1", author: "Alice", text: "Useful reply" },
	{ id: "r2", author: "Bob", text: "Check my bio for free followers" },
];

describe("ai filter request", () => {
	it("asks one typed question per reply and shares the thread as state", () => {
		const body = buildAiRequest("Original post", items) as {
			model: string;
			state: { parent_post: string | null; replies: unknown[] };
			questions: Record<string, { type: string; instructions: string }>;
		};
		expect(body.model).toBe("jev-latest");
		expect(body.state.parent_post).toBe("Original post");
		expect(body.state.replies).toEqual([
			{ id: "r1", author: "Alice", text: "Useful reply" },
			{ id: "r2", author: "Bob", text: "Check my bio for free followers" },
		]);
		expect(Object.keys(body.questions)).toEqual([
			aiQuestionKey("r1"),
			aiQuestionKey("r2"),
		]);
		for (const question of Object.values(body.questions)) {
			expect(question.type).toBe("noul");
		}
		expect(body.questions[aiQuestionKey("r2")].instructions).toContain('"r2"');
	});

	it("omits the parent post when the page has none", () => {
		const body = buildAiRequest("", items) as { state: { parent_post: null } };
		expect(body.state.parent_post).toBeNull();
	});

	it("collapses whitespace and truncates very long text", () => {
		expect(truncate("a  \n b", 100)).toBe("a b");
		expect(truncate("x".repeat(20), 5)).toBe("xxxxx…");
	});
});

describe("ai filter response", () => {
	it("maps question keys back to reply ids", () => {
		expect(
			parseAiResponse(
				{
					answers: {
						[aiQuestionKey("r1")]: { type: "noul", noul: 0.02 },
						[aiQuestionKey("r2")]: { type: "noul", noul: 0.97 },
					},
				},
				items,
			),
		).toEqual({ r1: 0.02, r2: 0.97 });
	});

	it("ignores unknown ids, stray keys, and out-of-range values", () => {
		expect(
			parseAiResponse(
				{
					answers: {
						r9_noise: { noul: 0.9 },
						r1_other: { noul: 0.9 },
						r1_noise: { noul: 1.4 },
					},
				},
				items,
			),
		).toEqual({ r1: 1 });
	});

	it("reports a payload that is not a System One response", () => {
		expect(parseAiResponse({ error: "nope" }, items)).toBeNull();
		expect(parseAiResponse(null, items)).toBeNull();
	});

	it("gates on the calibrated probability, not on a yes/no", () => {
		expect(shouldFilter(AI_NOISE_THRESHOLD)).toBe(true);
		expect(shouldFilter(AI_NOISE_THRESHOLD - 0.01)).toBe(false);
	});
});

describe("ai filter cache", () => {
	it("reuses a verdict for text that differs only in whitespace or case", () => {
		expect(aiFingerprint("Hello  World")).toBe(aiFingerprint("hello world"));
		expect(aiFingerprint("Hello World")).not.toBe(aiFingerprint("Hello there"));
	});

	it("expires old verdicts", () => {
		const now = 1_000_000;
		const cache = withCachedVerdict({}, "k", 0.95, now);
		expect(readCachedProbability(cache, "k", now)).toBe(0.95);
		expect(
			readCachedProbability(cache, "k", now + AI_CACHE_TTL_MS + 1),
		).toBeNull();
	});

	it("keeps the cache bounded", () => {
		let cache = {};
		for (let i = 0; i < AI_CACHE_MAX_ENTRIES + 10; i++) {
			cache = withCachedVerdict(cache, `k${i}`, 0.9, i);
		}
		const keys = Object.keys(cache);
		expect(keys).toHaveLength(AI_CACHE_MAX_ENTRIES);
		expect(keys).not.toContain("k0");
	});
});

describe("ai credentials", () => {
	it("never surfaces a key it was not given", () => {
		expect(parseAiSecrets(undefined).apiKey).toBe("");
		expect(parseAiSecrets({ apiKey: 42 }).apiKey).toBe("");
		expect(parseAiSecrets({ apiKey: "  ts_abc  " }).apiKey).toBe("ts_abc");
	});

	it("drops malformed cache entries instead of trusting them", () => {
		expect(
			parseAiCache({ good: { probability: 0.9, at: 1 }, bad: { at: 1 } }),
		).toEqual({ good: { probability: 0.9, at: 1 } });
		expect(parseAiCache("nonsense")).toEqual({});
	});
});
