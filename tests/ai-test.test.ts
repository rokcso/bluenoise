import { describe, expect, it } from "vitest";
import { parseAiProviderTests } from "@/src/contracts/ai";
import {
	AI_PROBE_QUESTION,
	buildProviderProbe,
	judgeProbeResponse,
} from "@/src/domain/ai-test";

const jev = {
	kind: "jev" as const,
	endpoint: "https://api.example.test/v1/systemone",
	model: "jev-latest",
};
const llm = {
	kind: "llm" as const,
	endpoint: "https://api.example.test/v1/chat/completions",
	model: "gpt-4o-mini",
};

describe("provider probe", () => {
	it("asks a judgment model one typed question", () => {
		const probe = buildProviderProbe(jev, "ts_key");
		if (!probe) throw new Error("probe not built");
		expect(probe.url).toBe(jev.endpoint);
		const body = JSON.parse(String(probe.init.body));
		expect(body.model).toBe("jev-latest");
		expect(body.questions[AI_PROBE_QUESTION].type).toBe("noul");
		const headers = probe.init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer ts_key");
	});

	it("asks a chat model for one short completion", () => {
		const probe = buildProviderProbe(llm, "sk_key");
		if (!probe) throw new Error("probe not built");
		const body = JSON.parse(String(probe.init.body));
		expect(body.model).toBe("gpt-4o-mini");
		expect(body.messages).toHaveLength(1);
		expect(body.max_tokens).toBeLessThanOrEqual(16);
	});

	it("refuses to probe an incomplete form", () => {
		expect(buildProviderProbe({ ...jev, endpoint: "  " }, "k")).toBeNull();
		expect(buildProviderProbe({ ...jev, model: "" }, "k")).toBeNull();
	});

	it("treats a non-2xx status as a failure", () => {
		expect(judgeProbeResponse("jev", 401, { answers: {} })).toEqual({
			ok: false,
			detail: "http-401",
		});
		expect(judgeProbeResponse("llm", 429, { choices: [{}] })).toEqual({
			ok: false,
			detail: "http-429",
		});
	});

	it("does not trust a 200 that is not the expected dialect", () => {
		// Gateways return error documents with a 200; a bare OK is not proof.
		expect(judgeProbeResponse("jev", 200, { answers: {} })).toEqual({
			ok: false,
			detail: "unexpected-response",
		});
		expect(
			judgeProbeResponse("jev", 200, { answers: { probe_noise: {} } }),
		).toEqual({ ok: false, detail: "unexpected-response" });
		expect(judgeProbeResponse("llm", 200, { error: "bad key" })).toEqual({
			ok: false,
			detail: "unexpected-response",
		});
		expect(judgeProbeResponse("llm", 200, null)).toEqual({
			ok: false,
			detail: "unexpected-response",
		});
	});

	it("accepts a response that carries the expected shape", () => {
		expect(
			judgeProbeResponse("jev", 200, {
				answers: { [AI_PROBE_QUESTION]: { noul: 0.12 } },
			}),
		).toEqual({ ok: true });
		expect(
			judgeProbeResponse("llm", 200, { choices: [{ message: {} }] }),
		).toEqual({ ok: true });
		// An empty choices array is a well-formed but useless answer.
		expect(judgeProbeResponse("llm", 200, { choices: [] })).toEqual({
			ok: false,
			detail: "unexpected-response",
		});
	});
});

describe("cached provider tests", () => {
	it("keeps only well-formed entries", () => {
		expect(
			parseAiProviderTests({
				good: { ok: true, at: 5 },
				bad: { ok: "yes", at: 5 },
				older: { ok: false, at: 1, detail: "http-401" },
			}),
		).toEqual({
			good: { ok: true, at: 5 },
			older: { ok: false, at: 1, detail: "http-401" },
		});
		expect(parseAiProviderTests("nonsense")).toEqual({});
		expect(parseAiProviderTests(undefined)).toEqual({});
	});
});
