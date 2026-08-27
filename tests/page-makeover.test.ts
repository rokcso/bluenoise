import { describe, expect, it } from "vitest";
import { findNewPostsPromptButton } from "@/src/content/page-makeover";

interface FakeElement {
	tagName: string;
	parentElement: FakeElement | null;
	hasUserAvatars?: boolean;
	closest(selector: string): FakeElement | null;
	querySelector(selector: string): FakeElement | null;
}

function element(
	tagName: string,
	parentElement: FakeElement | null = null,
	hasUserAvatars = false,
): FakeElement {
	return {
		tagName,
		parentElement,
		hasUserAvatars,
		closest(selector) {
			let node: FakeElement | null = this;
			while (node) {
				if (selector === "button" && node.tagName === "BUTTON") return node;
				node = node.parentElement;
			}
			return null;
		},
		querySelector(selector) {
			return selector === '[data-testid="userAvatars"]' && this.hasUserAvatars
				? this
				: null;
		},
	};
}

function asElement(value: FakeElement): Element {
	return value as unknown as Element;
}

describe("new posts prompt detection", () => {
	it("hides the button when X wraps the pill contents in a div", () => {
		const button = element("BUTTON");
		const wrapper = element("DIV", button, true);
		const label = element("DIV", wrapper);

		expect(findNewPostsPromptButton(asElement(label))).toBe(button);
	});
});
