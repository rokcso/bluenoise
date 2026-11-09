// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { createArticleEvaluator } from "@/src/content/evaluation";
import { createTweetMarker } from "@/src/content/marking";
import { isMainTweetArticle, statusIdFromPath } from "@/src/content/selectors";
import type { AppConfig, RuleView } from "@/src/contracts/config";
import { DEFAULTS } from "@/src/domain/defaults";
import { buildMatchers } from "@/src/domain/matcher";
import { installChromeMock } from "./helpers/chrome-mock";

/** Build the DOM X renders for one tweet inside its virtualized row. */
function renderTweet({
	handle = "someone",
	text = "just a normal post",
	name = "Someone",
	rowId = "row",
	statusId = "100",
}: Partial<{
	handle: string;
	text: string;
	name: string;
	rowId: string;
	statusId: string;
}> = {}): Element {
	const row = document.createElement("div");
	row.dataset.testid = "cellInnerDiv";
	row.id = rowId;
	row.innerHTML = `<article data-testid="tweet">
		<div data-testid="User-Name"><span>${name}</span><a href="/${handle}"><span>@${handle}</span></a></div>
		<a href="/${handle}/status/${statusId}"><time>now</time></a>
		<div data-testid="tweetText">${text}</div>
	</article>`;
	document.body.append(row);
	return row.querySelector("article") as Element;
}

function ruleView(overrides: Partial<RuleView> = {}): RuleView {
	return {
		keywordSourceEnabled: {},
		userKeywords: [],
		whitelist: [],
		accountWhitelist: [],
		accountBlacklist: [],
		subscriptions: [],
		...overrides,
	};
}

interface Harness {
	evaluator: ReturnType<typeof createArticleEvaluator>;
	evaluate(
		article: Element,
	): ReturnType<ReturnType<typeof createArticleEvaluator>["evaluate"]>;
	marker: ReturnType<typeof createTweetMarker>;
	config: AppConfig;
	setConfig(patch: Partial<AppConfig>): void;
	setRules(next: RuleView): void;
	/** Force the next evaluation to treat the rules as changed. */
	bumpGeneration(): void;
	applied: { hit: string | null; reason: unknown }[];
	aiQueued: { text: string }[];
}

function harness(
	options: {
		config?: Partial<AppConfig>;
		rules?: Partial<RuleView>;
		statusId?: string | null;
	} = {},
): Harness {
	let config: AppConfig = { ...DEFAULTS, ...(options.config ?? {}) };
	let rules = ruleView(options.rules);
	let generation = 1;
	const accountListVersion = 0;
	const marker = createTweetMarker({ getConfig: () => config });
	const applied: { hit: string | null; reason: unknown }[] = [];
	const aiQueued: { text: string }[] = [];
	let matchers = buildMatchers({ ...config, ...rules });
	const statusId = options.statusId ?? null;

	const evaluator = createArticleEvaluator({
		getConfig: () => config,
		getMatchers: () => matchers,
		getRuleView: () => rules,
		getAccountSourceIndexes: () => [],
		accountSourceNames: new Map(),
		getGeneration: () => generation,
		getAccountListVersion: () => accountListVersion,
		isMainTweet: (article) => isMainTweetArticle(article, statusId),
		applyMark: (article, hit, reason) => {
			applied.push({ hit, reason });
			marker.applyMark(article, hit, reason);
		},
		queueForAi: (_article, text) => {
			aiQueued.push({ text });
		},
	});

	return {
		evaluator,
		evaluate: evaluator.evaluate,
		marker,
		get config() {
			return config;
		},
		setConfig(patch) {
			config = { ...config, ...patch };
			matchers = buildMatchers({ ...config, ...rules });
			generation++;
		},
		setRules(next) {
			rules = { ...rules, ...next };
			matchers = buildMatchers({ ...config, ...rules });
			generation++;
		},
		bumpGeneration() {
			generation++;
		},
		applied,
		aiQueued,
	};
}

describe("article evaluation", () => {
	beforeEach(() => {
		installChromeMock({ uiLanguage: "en" });
		document.body.innerHTML = "";
	});

	it("filters a keyword match and marks the row with the matched rule", () => {
		const h = harness({ rules: { userKeywords: ["加微信"] } });
		const article = renderTweet({ text: "私我 加微信 领福利" });

		const result = h.evaluate(article);

		expect(result.outcome).toBe("filtered");
		expect(h.applied.at(-1)?.hit).toBe("加微信");
		const row = document.getElementById("row") as Element;
		expect(row.classList.contains("bluenoise-filtered")).toBe(true);
	});

	it("leaves a clean post alone", () => {
		const h = harness({ rules: { userKeywords: ["加微信"] } });
		const article = renderTweet({ text: "今天天气不错" });

		expect(h.evaluate(article).outcome).toBe("no-match");
		expect(document.getElementById("row")?.className).toBe("");
	});

	it("reports no-active-rules instead of silently matching nothing", () => {
		const h = harness({
			config: { accountSourceEnabled: { bluenoise: false, mxga: false } },
		});
		const article = renderTweet({ text: "加微信" });

		expect(h.evaluate(article).outcome).toBe("no-active-rules");
	});

	it("never filters the post the user opened", () => {
		const h = harness({
			rules: { userKeywords: ["加微信"] },
			statusId: "100",
		});
		const article = renderTweet({ handle: "someone", text: "加微信" });

		// The article is the one whose permalink matches the current route.
		expect(h.evaluate(article).outcome).toBe("main-tweet");
		expect(document.getElementById("row")?.className).toBe("");
	});

	it("still filters replies on a status page", () => {
		const h = harness({
			rules: { userKeywords: ["加微信"] },
			statusId: "100",
		});
		// The opened post is the first article on the page, so it must exist for
		// the "is this the main tweet" check to have anything to compare against.
		renderTweet({
			handle: "author",
			text: "the post I opened",
			rowId: "main",
			statusId: "100",
		});
		const reply = renderTweet({
			handle: "spammer",
			text: "加微信",
			rowId: "reply",
			statusId: "200",
		});

		expect(h.evaluate(reply).outcome).toBe("filtered");
	});

	it("reuses the cached verdict until something that matters changes", () => {
		const h = harness({ rules: { userKeywords: ["加微信"] } });
		const article = renderTweet({ text: "加微信" });

		expect(h.evaluate(article).fresh).toBe(true);
		expect(h.evaluate(article).outcome).toBe("cache-hit");

		// Same text, rewritten in place: X re-renders often, and re-running the
		// full tree walk for identical content is what made scrolling janky.
		const body = article.querySelector('[data-testid="tweetText"]');
		if (!body) throw new Error("fixture is missing the tweet text node");
		body.textContent = "加微信";
		expect(h.evaluate(article).outcome).toBe("cache-hit");
	});

	it("re-evaluates when the rule generation changes", () => {
		const h = harness({ rules: { userKeywords: ["加微信"] } });
		const article = renderTweet({ text: "加微信" });
		h.evaluate(article);

		h.bumpGeneration();

		const afterBump = h.evaluate(article);
		expect(afterBump.outcome).toBe("filtered");
		expect(afterBump.fresh).toBe(true);
	});

	it("re-evaluates when the text actually changes", () => {
		const h = harness({ rules: { userKeywords: ["加微信"] } });
		const article = renderTweet({ text: "今天天气不错" });
		expect(h.evaluate(article).outcome).toBe("no-match");

		const text = article.querySelector('[data-testid="tweetText"]') as Element;
		text.textContent = "加微信 领福利";
		// X reports the text change as a mutation; content.ts marks the article
		// dirty so the cheap prefix check cannot reuse the old verdict.
		h.evaluator.markTextDirty(article);

		expect(h.evaluate(article).outcome).toBe("filtered");
	});

	it("lets an explicit account whitelist outrank a keyword hit", () => {
		const h = harness({
			rules: {
				userKeywords: ["加微信"],
				whitelist: [],
				accountWhitelist: ["someone"],
			},
		});
		const article = renderTweet({ text: "加微信" });

		expect(h.evaluate(article).outcome).toBe("no-match");
		expect(document.getElementById("row")?.className).toBe("");
	});

	it("filters an account on a manual blacklist without any keyword", () => {
		const h = harness({ rules: { accountBlacklist: ["someone"] } });
		const article = renderTweet({ text: "今天天气不错" });

		expect(h.evaluate(article).outcome).toBe("filtered");
		expect(h.applied.at(-1)?.hit).toBe("account:blacklist");
	});

	it("classifies a promoted post as an ad when media ads are enabled", () => {
		const h = harness({ config: { filterMediaAds: true } });
		const article = renderTweet({ text: "buy this" });
		// X marks promotions by wrapping the article in placementTracking.
		const placement = document.createElement("div");
		placement.dataset.testid = "placementTracking";
		const row = document.getElementById("row") as Element;
		row.insertBefore(placement, row.firstChild);
		placement.append(article);
		article.innerHTML += '<div data-testid="videoPlayer"></div>';

		expect(h.evaluate(article).outcome).toBe("filtered");
		expect(h.applied.at(-1)?.hit).toBe("__ad__");
	});

	it("does not classify a plain media post as an ad", () => {
		const h = harness({ config: { filterMediaAds: true } });
		const article = renderTweet({ text: "look at this" });
		article.innerHTML += '<div data-testid="videoPlayer"></div>';

		expect(h.evaluate(article).outcome).toBe("no-match");
	});

	it("hands unmatched replies to the second pass, but never a matched one", () => {
		const h = harness({
			config: { aiFilterEnabled: true },
			rules: { userKeywords: ["加微信"] },
		});
		const clean = renderTweet({ text: "今天天气不错", rowId: "clean" });
		const matched = renderTweet({
			text: "加微信",
			handle: "spam",
			rowId: "spam",
		});

		h.evaluate(clean);
		h.evaluate(matched);

		expect(h.aiQueued).toHaveLength(1);
		expect(h.aiQueued[0].text).toContain("今天天气不错");
	});

	it("does not hand a whitelisted author to the second pass", () => {
		const h = harness({
			config: { aiFilterEnabled: true },
			rules: { accountWhitelist: ["someone"] },
		});
		h.evaluate(renderTweet({ text: "今天天气不错" }));

		expect(h.aiQueued).toHaveLength(0);
	});

	it("applies a Jev verdict to an already cached reply", () => {
		const h = harness({ config: { aiFilterEnabled: true } });
		const article = renderTweet({ text: "今天天气不错" });
		h.evaluate(article);

		const applied = h.evaluator.applyExternalHit(article, "ai:noise", {
			category: "ai",
			probability: 0.93,
		});

		expect(applied).toBe(true);
		expect(h.applied.at(-1)?.hit).toBe("ai:noise");
		// A second verdict must not overwrite the hit the row already shows.
		expect(
			h.evaluator.applyExternalHit(article, "ai:noise", {
				category: "ai",
				probability: 0.99,
			}),
		).toBe(false);
	});

	it("drops a verdict for an article it has never evaluated", () => {
		const h = harness();
		const article = renderTweet({ text: "never seen" });

		expect(
			h.evaluator.applyExternalHit(article, "ai:noise", {
				category: "ai",
				probability: 0.9,
			}),
		).toBe(false);
	});
});

describe("route reads", () => {
	it("reads the status id from a tweet detail path", () => {
		expect(statusIdFromPath("/someone/status/1720000000000000000")).toBe(
			"1720000000000000000",
		);
	});

	it("has no status id on feeds", () => {
		expect(statusIdFromPath("/home")).toBeNull();
		expect(statusIdFromPath("/someone")).toBeNull();
	});
});
