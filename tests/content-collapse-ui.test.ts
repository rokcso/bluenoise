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

	it("switches presentation without clearing matched rows", () => {
		const watcher = content.slice(
			content.indexOf("function watchConfig()"),
			content.indexOf("// ==================== Startup"),
		);
		expect(watcher).toContain("syncPresentation()");
		expect(watcher).toContain("const reclassify =");
	});

	it("animates only the local row without notifying X globally", () => {
		expect(content).toContain("function animateCollapseResize(");
		expect(content).toContain("collapseAnimations.get(row)?.cancel()");
		expect(content).toContain("prefers-reduced-motion: reduce");
		expect(content).not.toContain('window.dispatchEvent(new Event("resize"))');
		expect(content).not.toContain('scrollIntoView({ block: "nearest" })');
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
