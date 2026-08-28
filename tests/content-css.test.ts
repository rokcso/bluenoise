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
		expect(css).toContain(".bluenoise-filtered.bluenoise-revealing::after");
		expect(css).toContain("backdrop-filter: blur(6px)");
		expect(css).toContain("mask-image: radial-gradient(");
		expect(css).not.toContain(".bluenoise-reveal {");
	});

	it("switches reveal and blur atomically without an opacity transition", () => {
		expect(css).not.toContain("transition: opacity");
		expect(css).not.toContain("filter 0.2s ease");
	});
});

describe("collapsed filtering styles", () => {
	it("keeps the source row mounted behind a reversible placeholder", () => {
		expect(css).toContain('[data-bluenoise-mode="collapse"]');
		expect(css).toContain(":not(.bluenoise-collapse-placeholder)");
		expect(css).toContain(".bluenoise-collapse-expanded");
		expect(css).not.toContain(
			'[data-bluenoise-mode="collapse"] .bluenoise-filtered {\n\tdisplay: none',
		);
	});
});

describe("Premium feature prompt styles", () => {
	it("hide the entire timeline cell using stable prompt markers", () => {
		expect(css).toContain("[data-bluenoise-hide-premium-feature-prompt]");
		expect(css).toContain('[data-testid="inlinePrompt"] a[href^="/i/premium"]');
		expect(css).not.toContain("你已解锁");
	});
});

describe("sidebar loading state cleanup", () => {
	it("hides the trends loader before trend rows are rendered", () => {
		expect(css).toContain('[data-testid="sidebarColumn"]');
		expect(css).toContain(
			'div[aria-label]:has([role="search"]):has([role="progressbar"])',
		);
	});

	it("hides the follow-suggestions loader and its module wrapper", () => {
		expect(css).toContain(
			'div[aria-label]:has([role="search"])\n\t+ div:has(> div > div > [role="progressbar"])',
		);
		expect(css).not.toContain('[aria-label*="推荐关注"]');
		expect(css).not.toContain('[aria-label*="Who to follow" i]');
	});
});
