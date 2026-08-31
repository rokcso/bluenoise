import { describe, expect, it } from "vitest";
import {
	findNewPostsPromptButton,
	isMobileLiveDockRail,
	reconcileHiddenElements,
} from "@/src/content/page-makeover";

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

describe("mobile live dock detection", () => {
	function railWithLabel(label: string): Element {
		return {
			querySelectorAll: () => [
				{
					getAttribute: (name: string) =>
						name === "aria-label" ? label : null,
				},
			],
		} as unknown as Element;
	}

	it.each([
		"Broadcast, host",
		"Space, topic",
		"\u76f4\u64ad\uff0c\u4e3b\u6301\u4eba",
		"\u7a7a\u95f4, \u8bdd\u9898",
	])("recognizes a live button labelled %s", (label) => {
		expect(isMobileLiveDockRail(railWithLabel(label))).toBe(true);
	});

	it("does not treat an unrelated swipeable list as a live dock", () => {
		expect(isMobileLiveDockRail(railWithLabel("Open profile"))).toBe(false);
	});
});

describe("incremental makeover visibility", () => {
	it("does not reveal an element that remains hidden across applies", () => {
		const calls: string[] = [];
		const target = {
			isConnected: true,
			setAttribute: () => calls.push("hide"),
			removeAttribute: () => calls.push("show"),
		} as unknown as HTMLElement;

		let hidden = reconcileHiddenElements(new Set(), new Set([target]));
		hidden = reconcileHiddenElements(hidden, new Set([target]));

		expect(calls).toEqual(["hide"]);
		expect(hidden.has(target)).toBe(true);
	});
});
