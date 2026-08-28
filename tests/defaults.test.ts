import { describe, expect, it } from "vitest";
import { loadConfig } from "@/src/domain/defaults";

describe("configuration defaults", () => {
	it("shows filter reasons for new and existing installations by default", () => {
		expect(loadConfig(undefined).showFilterReason).toBe(true);
		expect(loadConfig({ enabled: true }).showFilterReason).toBe(true);
	});

	it("leaves the Premium feature prompt visible until explicitly hidden", () => {
		expect(loadConfig(undefined).hidePremiumFeaturePrompt).toBe(false);
		expect(loadConfig({ enabled: true }).hidePremiumFeaturePrompt).toBe(false);
	});

	it("accepts collapse as a persisted filtering mode", () => {
		expect(loadConfig({ mode: "collapse" }).mode).toBe("collapse");
	});
});
