import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(
	new URL("../entrypoints/popup/App.tsx", import.meta.url),
	"utf8",
);

describe("filtering settings visibility", () => {
	it("always renders mode-dependent preferences for preconfiguration", () => {
		expect(app).toContain('label={t("show_filter_reason")}');
		expect(app).toContain('label={t("reveal_on_hover")}');
		expect(app).not.toContain('{config.mode !== "hide" && (');
		expect(app).not.toContain('{config.mode === "dim" && (');
	});

	it("exposes the dim opacity control in the treatment group", () => {
		expect(app).toContain('label={t("dim_opacity")}');
		expect(app).toContain("MIN_DIM_OPACITY");
		expect(app).toContain("MAX_DIM_OPACITY");
		expect(app).toContain("update({ dimOpacity:");
		expect(app).toContain("<DimPreview");
	});
});
