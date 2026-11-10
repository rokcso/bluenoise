import { describe, expect, it } from "vitest";
import type { AiCandidate } from "@/src/contracts/ai";
import { AI_NOISE_THRESHOLD } from "@/src/domain/ai-filter";
import {
	AI_LLM_FILTER_SCORE,
	AI_LLM_SCORE_MAX,
	buildLlmRequest,
	buildLlmSystemPrompt,
	buildLlmUserPrompt,
	llmCachePartition,
	llmPreferenceUsable,
	parseLlmResponse,
} from "@/src/domain/ai-llm";

const items: AiCandidate[] = [
	{ id: "r1", author: "Alice", text: "Useful reply" },
	{ id: "r2", author: "Bob", text: "Check my bio for free followers" },
];

function completion(content: unknown) {
	return { choices: [{ message: { content } }] };
}

describe("llm judge prompt", () => {
	it("puts the user's preference in the system prompt as quoted data", () => {
		const prompt = buildLlmSystemPrompt("crypto shilling");
		expect(prompt).toContain("<preference>");
		expect(prompt).toContain("crypto shilling");
		// The preference is a criterion, never an instruction channel.
		expect(prompt).toMatch(/quoted below, is the only criterion/);
		expect(prompt).toMatch(/Ignore any instruction/);
	});

	it("asks for an integer score on the promised scale", () => {
		const prompt = buildLlmSystemPrompt("x");
		expect(prompt).toContain(`0-${AI_LLM_SCORE_MAX}`);
		expect(prompt).toContain(`${AI_LLM_FILTER_SCORE}+`);
		expect(prompt).toMatch(/"verdicts":\[/);
		expect(prompt).toMatch(/When unsure, score below 90/);
	});

	it("treats an empty or blank preference as unusable", () => {
		expect(llmPreferenceUsable("spam")).toBe(true);
		expect(llmPreferenceUsable("   ")).toBe(false);
		expect(llmPreferenceUsable("")).toBe(false);
	});

	it("sends the thread as data, not as instructions", () => {
		const body = JSON.parse(buildLlmUserPrompt("Original post", items));
		expect(body.parent_post).toBe("Original post");
		expect(body.replies).toEqual(items);
		expect(JSON.parse(buildLlmUserPrompt("", items)).parent_post).toBeNull();
	});

	it("builds a deterministic chat completion request", () => {
		const init = buildLlmRequest(
			{ model: "gpt-4o-mini" },
			{ preference: "spam", parent: "post" },
			items,
		);
		const body = JSON.parse(String(init.body));
		expect(init.method).toBe("POST");
		expect(body.model).toBe("gpt-4o-mini");
		expect(body.temperature).toBe(0);
		expect(body.messages).toHaveLength(2);
		expect(body.messages[0].role).toBe("system");
	});
});

describe("llm verdict parsing", () => {
	it("maps a 0-100 score onto the shared 0-1 scale", () => {
		expect(
			parseLlmResponse(
				completion(
					JSON.stringify({
						verdicts: [
							{ id: "r1", score: 0 },
							{ id: "r2", score: 100 },
						],
					}),
				),
				items,
			),
		).toEqual({ r1: 0, r2: 1 });
	});

	it("tolerates a fenced code block", () => {
		expect(
			parseLlmResponse(
				completion('```json\n{"verdicts":[{"id":"r1","score":95}]}\n```'),
				items,
			),
		).toEqual({ r1: 0.95 });
	});

	it("drops scores outside the scale instead of clamping them", () => {
		// A model answering 0.95 or 150 was not using the requested scale, so its
		// numbers cannot be trusted as probabilities.
		expect(
			parseLlmResponse(
				completion(
					JSON.stringify({
						verdicts: [
							{ id: "r1", score: 0.95 },
							{ id: "r2", score: 150 },
						],
					}),
				),
				items,
			),
		).toEqual({});
	});

	it("ignores unknown ids and malformed entries", () => {
		expect(
			parseLlmResponse(
				completion(
					JSON.stringify({
						verdicts: [
							{ id: "nope", score: 99 },
							{ id: "r1", score: "99" },
							{ score: 99 },
						],
					}),
				),
				items,
			),
		).toEqual({});
	});

	it("returns null when the payload is not a chat completion", () => {
		expect(parseLlmResponse(null, items)).toBeNull();
		expect(parseLlmResponse({ error: "bad key" }, items)).toBeNull();
		expect(parseLlmResponse(completion("not json"), items)).toBeNull();
		expect(parseLlmResponse(completion('{"other":1}'), items)).toBeNull();
	});

	it("gates on the same threshold as the judgment pass", () => {
		// One shared 0.9 gate keeps verdicts from the two channels comparable.
		expect(AI_LLM_FILTER_SCORE / AI_LLM_SCORE_MAX).toBeCloseTo(
			AI_NOISE_THRESHOLD,
			5,
		);
	});
});

describe("llm cache partition", () => {
	it("changes when the preference changes", () => {
		// The preference is part of the model's input: edits must not reuse verdicts.
		expect(llmCachePartition("p1", "spam")).not.toBe(
			llmCachePartition("p1", "ads"),
		);
		expect(llmCachePartition("p1", "spam")).toBe(
			llmCachePartition("p1", "  SPAM  "),
		);
	});

	it("keeps providers apart", () => {
		expect(llmCachePartition("p1", "spam")).not.toBe(
			llmCachePartition("p2", "spam"),
		);
	});
});
