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
});
