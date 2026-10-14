import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIM_OPACITY,
	loadConfig,
	MAX_DIM_OPACITY,
	MIN_DIM_OPACITY,
} from "@/src/domain/defaults";

describe("configuration defaults", () => {
	it("shows filter reasons for new and existing installations by default", () => {
		expect(loadConfig(undefined).showFilterReason).toBe(true);
		expect(loadConfig({ enabled: true }).showFilterReason).toBe(true);
	});

	it("leaves the Premium feature prompt visible until explicitly hidden", () => {
		expect(loadConfig(undefined).hidePremiumFeaturePrompt).toBe(false);
		expect(loadConfig({ enabled: true }).hidePremiumFeaturePrompt).toBe(false);
	});

	it("leaves sports score cards visible until explicitly hidden", () => {
		expect(loadConfig(undefined).hideSportsScores).toBe(false);
		expect(loadConfig({ enabled: true }).hideSportsScores).toBe(false);
	});

	it("accepts collapse as a persisted filtering mode", () => {
		expect(loadConfig({ mode: "collapse" }).mode).toBe("collapse");
	});

	it("clamps the dim opacity to a perceivable range", () => {
		expect(loadConfig(undefined).dimOpacity).toBe(DEFAULT_DIM_OPACITY);
		expect(loadConfig({ dimOpacity: 0 }).dimOpacity).toBe(MIN_DIM_OPACITY);
		expect(loadConfig({ dimOpacity: 5 }).dimOpacity).toBe(MAX_DIM_OPACITY);
		expect(loadConfig({ dimOpacity: Number.NaN }).dimOpacity).toBe(
			DEFAULT_DIM_OPACITY,
		);
	});
});
