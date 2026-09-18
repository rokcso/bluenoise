import { describe, expect, it } from "vitest";
import { parseAiGate } from "@/src/contracts/ai";
import {
	AI_COOLDOWN_AUTH_MS,
	AI_COOLDOWN_BASE_MS,
	AI_COOLDOWN_MAX_MS,
	AI_WINDOW_MAX_REQUESTS,
	AI_WINDOW_MS,
	classifyFailure,
	emptyGate,
	gateBlock,
	parseRetryAfter,
	recordFailure,
	recordRequest,
	recordSuccess,
} from "@/src/domain/ai-gate";

const T0 = 1_700_000_000_000;

describe("ai quota gate", () => {
	it("allows requests until the window is full", () => {
		let gate = emptyGate();
		for (let i = 0; i < AI_WINDOW_MAX_REQUESTS; i++) {
			expect(gateBlock(gate, T0)).toBeNull();
			gate = recordRequest(gate, T0);
		}
		expect(gateBlock(gate, T0)).toBe("budget-exceeded");
		// The window rolls: the same gate frees up once the oldest spend ages out.
		expect(gateBlock(gate, T0 + AI_WINDOW_MS)).toBeNull();
	});

	it("forgets spends older than the window instead of accumulating them", () => {
		let gate = recordRequest(emptyGate(), T0);
		for (let i = 1; i < AI_WINDOW_MAX_REQUESTS; i++) {
			gate = recordRequest(gate, T0 + 1);
		}
		const later = recordRequest(gate, T0 + AI_WINDOW_MS);
		expect(Math.min(...later.window)).toBe(T0 + 1);
		expect(later.window.length).toBe(AI_WINDOW_MAX_REQUESTS);
	});

	it("parks the feature for a long while after a rejected key", () => {
		const gate = recordFailure(emptyGate(), "auth", null, T0);
		expect(gate.cooldownUntil).toBe(T0 + AI_COOLDOWN_AUTH_MS);
		expect(gateBlock(gate, T0 + 1)).toBe("cooling-down");
		expect(gateBlock(gate, T0 + AI_COOLDOWN_AUTH_MS)).toBeNull();
	});

	it("obeys the provider's Retry-After on a rate limit", () => {
		const gate = recordFailure(emptyGate(), "rate-limit", 5_000, T0);
		expect(gate.cooldownUntil).toBe(T0 + 5_000);
	});

	it("falls back to an exponential wait when nothing is advertised", () => {
		let gate = emptyGate();
		const waits: number[] = [];
		for (let i = 0; i < 3; i++) {
			gate = recordFailure(gate, "server", null, T0);
			waits.push(gate.cooldownUntil - T0);
		}
		expect(waits).toEqual([
			AI_COOLDOWN_BASE_MS,
			AI_COOLDOWN_BASE_MS * 2,
			AI_COOLDOWN_BASE_MS * 4,
		]);
	});

	it("never waits longer than the ceiling", () => {
		const gate = recordFailure(
			emptyGate(),
			"rate-limit",
			10 * 60 * 60 * 1000,
			T0,
		);
		expect(gate.cooldownUntil).toBe(T0 + AI_COOLDOWN_MAX_MS);
	});

	it("clears the cooldown after a request that worked", () => {
		let gate = recordFailure(emptyGate(), "server", null, T0);
		gate = recordSuccess(gate, T0 + 1000);
		expect(gate).toEqual({ window: [], cooldownUntil: 0, failures: 0 });
		expect(gateBlock(gate, T0 + 1000)).toBeNull();
	});

	it("classifies failures by status", () => {
		expect(classifyFailure(401)).toBe("auth");
		expect(classifyFailure(403)).toBe("auth");
		expect(classifyFailure(429)).toBe("rate-limit");
		expect(classifyFailure(500)).toBe("server");
		expect(classifyFailure(502)).toBe("server");
		expect(classifyFailure(null)).toBe("network");
	});

	it("reads Retry-After as seconds, an HTTP date, or nothing", () => {
		expect(parseRetryAfter("120", T0)).toBe(120_000);
		expect(parseRetryAfter("0", T0)).toBe(0);
		expect(parseRetryAfter(new Date(T0 + 30_000).toUTCString(), T0)).toBe(
			30_000,
		);
		expect(parseRetryAfter("soon", T0)).toBeNull();
		expect(parseRetryAfter("", T0)).toBeNull();
		expect(parseRetryAfter(null, T0)).toBeNull();
	});

	it("survives a storage round trip and ignores junk", () => {
		const gate = recordRequest(
			recordFailure(emptyGate(), "auth", null, T0),
			T0,
		);
		expect(parseAiGate(JSON.parse(JSON.stringify(gate)))).toEqual(gate);
		expect(parseAiGate(undefined)).toEqual(emptyGate());
		expect(
			parseAiGate({ window: ["x"], cooldownUntil: "soon", failures: -3 }),
		).toEqual(emptyGate());
	});
});
