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
