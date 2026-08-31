import { describe, expect, it } from "vitest";
import { canReuseFastEvaluation } from "@/src/content/evaluation-cache";

describe("article evaluation cache", () => {
	it("invalidates a non-ad result when delayed card markup reveals an ad", () => {
		expect(
			canReuseFastEvaluation({
				cachedSignature: "1\u001f42\u001f\u001fStarlink",
				cachedPreset: undefined,
				currentPreset: "ad",
				textDirty: false,
				structureDirty: true,
				generation: 1,
				accountListVersion: 42,
				separator: "\u001f",
			}),
		).toBe(false);
	});

	it("reuses an unchanged result without rereading article text", () => {
		expect(
			canReuseFastEvaluation({
				cachedSignature: "3\u001f42\u001fad\u001fStarlink",
				cachedPreset: "ad",
				currentPreset: "ad",
				textDirty: false,
				structureDirty: false,
				generation: 3,
				accountListVersion: 42,
				separator: "\u001f",
			}),
		).toBe(true);
	});

	it("invalidates an unchanged preset when its ad structure changed", () => {
		expect(
			canReuseFastEvaluation({
				cachedSignature: "3\u001f42\u001f\u001fStarlink",
				cachedPreset: undefined,
				currentPreset: undefined,
				textDirty: false,
				structureDirty: true,
				generation: 3,
				accountListVersion: 42,
				separator: "\u001f",
			}),
		).toBe(false);
	});
});
