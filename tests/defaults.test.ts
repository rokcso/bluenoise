import { describe, expect, it } from "vitest";
import { loadConfig } from "@/src/domain/defaults";

describe("configuration defaults", () => {
	it("shows filter reasons for new and existing installations by default", () => {
		expect(loadConfig(undefined).showFilterReason).toBe(true);
		expect(loadConfig({ enabled: true }).showFilterReason).toBe(true);
	});
});
