import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const content = readFileSync(
	new URL("../entrypoints/content.ts", import.meta.url),
	"utf8",
);

describe("collapsed post placeholder", () => {
	it("stays above the source post when expanded", () => {
		expect(content).toContain("row.prepend(placeholder)");
		expect(content).not.toContain("row.append(placeholder)");
	});

	it("cleans filtering state when the extension is reloaded", () => {
		const teardown = content.slice(
			content.indexOf("function teardown()"),
			content.indexOf(
				"function refresh(",
				content.indexOf("function teardown()"),
			),
		);
		expect(teardown).toContain("clearAllMarks()");
		expect(teardown).toContain("root.removeAttribute(MODE_ATTR)");
		expect(teardown).toContain("revealController.hide()");
	});
});
