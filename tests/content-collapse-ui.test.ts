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

	it("notifies X to remeasure an expanded virtualized row", () => {
		expect(content).toContain('window.dispatchEvent(new Event("resize"))');
		expect(content).toContain('scrollIntoView({ block: "nearest" })');
	});

	it("switches presentation without clearing matched rows", () => {
		const watcher = content.slice(
			content.indexOf("function watchConfig()"),
			content.indexOf("// ==================== Startup"),
		);
		expect(watcher).toContain("syncPresentation()");
		expect(watcher).toContain("const reclassify =");
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
		expect(teardown).toContain(
			"root.getAttribute(DOM_OWNER_ATTR) === DEBUG_SESSION_ID",
		);
	});
});
