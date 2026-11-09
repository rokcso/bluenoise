// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	COLLAPSE_EXPANDED_CLASS,
	createTweetMarker,
	FILTERED_CLASS,
	HIT_ATTR,
} from "@/src/content/marking";
import type { AppConfig } from "@/src/contracts/config";
import { DEFAULTS } from "@/src/domain/defaults";
import { installChromeMock } from "./helpers/chrome-mock";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
	return { ...DEFAULTS, ...overrides };
}

/** Build the DOM X renders for one tweet: a cell row wrapping an article. */
function renderTweet({ text = "hello" }: { text?: string } = {}): Element {
	document.body.innerHTML = `
		<div data-testid="cellInnerDiv" id="row">
			<article data-testid="tweet">
				<div data-testid="User-Name"><span>Someone</span><a href="/someone"><span>@someone</span></a></div>
				<div data-testid="tweetText">${text}</div>
			</article>
		</div>`;
	return document.querySelector("article") as Element;
}

const reason = {
	category: "keyword",
	kind: "plain",
	rule: "加微信",
	source: "user",
} as const;

describe("filtered post marking", () => {
	beforeEach(() => {
		installChromeMock({ uiLanguage: "en" });
		document.body.innerHTML = "";
	});

	it("marks the row X renders around the tweet, not the article", () => {
		const marker = createTweetMarker({ getConfig: () => config() });
		const article = renderTweet();
		marker.applyMark(article, "加微信", reason);

		const row = document.getElementById("row") as Element;
		expect(row.classList.contains(FILTERED_CLASS)).toBe(true);
		expect(row.getAttribute(HIT_ATTR)).toBe("加微信");
		expect(article.classList.contains(FILTERED_CLASS)).toBe(false);
	});

	it("shows the reason inside the row in dim mode only", () => {
		const state = { mode: "dim" as AppConfig["mode"] };
		const marker = createTweetMarker({
			getConfig: () => config({ mode: state.mode, showFilterReason: true }),
		});
		const article = renderTweet();

		marker.applyMark(article, "加微信", reason);
		const row = document.getElementById("row") as Element;
		const label = row.querySelector(".bluenoise-filter-reason");
		expect(label?.textContent).toContain("加微信");

		// Switching to hide mode must not leave a visible reason behind.
		state.mode = "hide";
		marker.applyMark(article, "加微信", reason);
		expect(row.querySelector(".bluenoise-filter-reason")).toBeNull();
	});

	it("makes a hidden row inert and restores it when unfiltered", () => {
		const marker = createTweetMarker({
			getConfig: () => config({ mode: "hide" }),
		});
		const article = renderTweet();
		const row = document.getElementById("row") as HTMLElement;

		marker.applyMark(article, "加微信", reason);
		expect(row.inert).toBe(true);

		marker.applyMark(article, null, null);
		expect(row.inert).toBe(false);
		expect(row.classList.contains(FILTERED_CLASS)).toBe(false);
		expect(row.hasAttribute(HIT_ATTR)).toBe(false);
	});

	it("keeps a matched row marked when only the presentation changes", () => {
		const state = { mode: "dim" as AppConfig["mode"] };
		const marker = createTweetMarker({
			getConfig: () => config({ mode: state.mode }),
		});
		const article = renderTweet();
		marker.applyMark(article, "加微信", reason);

		// This is what the config watcher calls for a mode-only change: it must
		// not clear and re-add marks, which would flash every filtered post.
		state.mode = "hide";
		marker.syncInteractivity();

		const row = document.getElementById("row") as HTMLElement;
		expect(row.classList.contains(FILTERED_CLASS)).toBe(true);
		expect(row.inert).toBe(true);
	});

	it("puts the collapse placeholder above the tweet it replaces", () => {
		const marker = createTweetMarker({
			getConfig: () => config({ mode: "collapse" }),
		});
		const article = renderTweet();
		marker.applyMark(article, "加微信", reason);

		const row = document.getElementById("row") as Element;
		const placeholder = row.querySelector(".bluenoise-collapse-placeholder");
		expect(placeholder).not.toBeNull();
		expect(row.firstElementChild).toBe(placeholder);
	});

	it("expands a collapsed row on click and labels the action for screen readers", () => {
		const marker = createTweetMarker({
			getConfig: () => config({ mode: "collapse", showFilterReason: true }),
		});
		const article = renderTweet();
		marker.applyMark(article, "加微信", reason);

		const row = document.getElementById("row") as Element;
		const button = row.querySelector(
			".bluenoise-collapse-placeholder button",
		) as HTMLButtonElement;
		expect(button.getAttribute("aria-expanded")).toBe("false");

		button.click();

		expect(row.classList.contains(COLLAPSE_EXPANDED_CLASS)).toBe(true);
		expect(button.getAttribute("aria-expanded")).toBe("true");
	});

	it("animates only the row it is collapsing", () => {
		const animate = vi.fn(() => ({
			addEventListener: () => {},
			cancel: () => {},
		}));
		// The animation is skipped when the row did not change height, and
		// happy-dom reports 0 for every element. Give the row two heights.
		let measured = 0;
		const rect = Element.prototype.getBoundingClientRect;
		Element.prototype.getBoundingClientRect = () =>
			({ height: ++measured === 1 ? 100 : 200 }) as DOMRect;
		// happy-dom has no Web Animations API; the point of the test is that we
		// touch exactly one element and never a global.
		(Element.prototype as unknown as { animate: unknown }).animate = animate;
		const dispatchSpy = vi.spyOn(window, "dispatchEvent");
		const scrollSpy = vi.fn();
		(
			Element.prototype as unknown as { scrollIntoView: unknown }
		).scrollIntoView = scrollSpy;

		const marker = createTweetMarker({
			getConfig: () => config({ mode: "collapse" }),
		});
		const article = renderTweet();
		marker.applyMark(article, "加微信", reason);
		const button = document
			.getElementById("row")
			?.querySelector(".bluenoise-collapse-placeholder button") as HTMLElement;
		button.click();

		expect(animate).toHaveBeenCalledTimes(1);
		// `row.animate(...)`, so the receiver is the row and nothing else.
		expect(animate.mock.instances[0]).toBe(document.getElementById("row"));
		expect(dispatchSpy).not.toHaveBeenCalled();
		expect(scrollSpy).not.toHaveBeenCalled();

		Element.prototype.getBoundingClientRect = rect;
	});

	it("clears every trace of filtering on reset", () => {
		const marker = createTweetMarker({
			getConfig: () => config({ mode: "hide" }),
		});
		const article = renderTweet();
		marker.applyMark(article, "加微信", reason);

		marker.clearAll();

		const row = document.getElementById("row") as HTMLElement;
		expect(row.className).toBe("");
		expect(row.hasAttribute(HIT_ATTR)).toBe(false);
		expect(row.inert).toBe(false);
		expect(row.querySelector(".bluenoise-collapse-placeholder")).toBeNull();
	});
});
