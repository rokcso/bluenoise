import { describe, expect, it } from "vitest";
import {
	isPromotedPost,
	shouldFilterPromotedPost,
} from "@/src/content/promoted";

interface FakeElement {
	parentElement: FakeElement | null;
	testId?: string;
	closest(selector: string): FakeElement | null;
	matches(selector: string): boolean;
	querySelector(selector: string): FakeElement | null;
}

function element(
	testId?: string,
	parentElement: FakeElement | null = null,
): FakeElement {
	return {
		parentElement,
		testId,
		closest(selector) {
			let node: FakeElement | null = this;
			while (node) {
				if (node.matches(selector)) return node;
				node = node.parentElement;
			}
			return null;
		},
		matches(selector) {
			if (selector === 'div[data-testid="cellInnerDiv"]')
				return this.testId === "cellInnerDiv";
			if (selector === '[data-testid="placementTracking"]')
				return this.testId === "placementTracking";
			return false;
		},
		querySelector() {
			return null;
		},
	};
}

function asElement(value: FakeElement): Element {
	return value as unknown as Element;
}

describe("promoted post detection", () => {
	it("matches when placement tracking wraps the article", () => {
		const cell = element("cellInnerDiv");
		const placement = element("placementTracking", cell);
		const article = element("tweet", placement);

		expect(isPromotedPost(asElement(article))).toBe(true);
	});

	it("ignores placement tracking inside a normal post's video player", () => {
		const cell = element("cellInnerDiv");
		const article = element("tweet", cell);
		const media = element("tweetPhoto", article);
		element("placementTracking", media);

		expect(isPromotedPost(asElement(article))).toBe(false);
	});

	it("keeps promoted posts filtered while staged creative markup is absent", () => {
		const cell = element("cellInnerDiv");
		const placement = element("placementTracking", cell);
		const article = element("tweet", placement);

		expect(
			shouldFilterPromotedPost(asElement(article), {
				media: true,
				card: true,
			}),
		).toBe(true);
	});
});
