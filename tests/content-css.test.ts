import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(
	new URL("../src/content/content.css", import.meta.url),
	"utf8",
);

describe("collapsed navigation sidebar styles", () => {
	it("hide only navigation labels, not nested unread badges", () => {
		expect(css).toContain(
			`nav[role="navigation"]
	> :is(a, button)
	> div
	> div[dir]`,
		);
		expect(css).not.toContain(
			`:is(nav[role="navigation"], [data-testid="SideNav_AccountSwitcher_Button"])
	[dir]`,
		);
	});
});

describe("hover reveal styles", () => {
	it("uses an in-place backdrop overlay instead of a cloned tweet layer", () => {
		expect(css).toContain(".xsf-filtered.xsf-revealing::after");
		expect(css).toContain("backdrop-filter: blur(3px)");
		expect(css).toContain("mask-image: radial-gradient(");
		expect(css).not.toContain(".xsf-reveal {");
	});

	it("switches reveal and blur atomically without an opacity transition", () => {
		expect(css).not.toContain("transition: opacity");
		expect(css).not.toContain("filter 0.2s ease");
	});
});

describe("Premium feature prompt styles", () => {
	it("hide the entire timeline cell using stable prompt markers", () => {
		expect(css).toContain("[data-xsf-hide-premium-feature-prompt]");
		expect(css).toContain('[data-testid="inlinePrompt"] a[href^="/i/premium"]');
		expect(css).not.toContain("你已解锁");
	});
});
