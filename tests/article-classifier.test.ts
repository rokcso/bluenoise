import { describe, expect, it } from "vitest";
import { classifyArticle } from "@/src/content/article-classifier";
import type { AppConfig } from "@/src/contracts/config";
import { DEFAULTS } from "@/src/domain/defaults";
import { buildMatchers } from "@/src/domain/matcher";

function context(userKeywords: string[] = []) {
	return {
		matchers: buildMatchers({
			...(DEFAULTS as AppConfig),
			userKeywords,
			whitelist: [],
			subscriptions: [],
		}),
		accountSources: [],
		accountWhitelist: [],
		accountBlacklist: [],
		accountSourceNames: new Map<string, string>(),
		debugLogging: false,
	};
}

describe("article classifier", () => {
	it("gives preset filters precedence over keyword rules", () => {
		expect(
			classifyArticle(
				{
					body: "抽奖",
					name: "",
					identity: {},
					preset: "ad",
				},
				context(["抽奖"]),
			),
		).toMatchObject({
			hit: "__ad__",
			reason: { category: "preset", type: "ad" },
		});
	});

	it("emits preset diagnostics only while debug logging is enabled", () => {
		const filterContext = context();
		filterContext.debugLogging = true;
		expect(
			classifyArticle(
				{
					body: "",
					name: "",
					identity: { handle: "brand" },
					preset: "ad",
				},
				filterContext,
			),
		).toMatchObject({
			log: { category: "preset", preset: "ad", handle: "brand" },
		});
	});

	it("returns a structured keyword reason", () => {
		expect(
			classifyArticle(
				{ body: "参加抽奖", name: "", identity: {} },
				context(["抽奖"]),
			),
		).toMatchObject({
			hit: "抽奖",
			reason: {
				category: "keyword",
				rule: "抽奖",
				source: "user",
			},
		});
	});

	it("preserves account whitelist precedence", () => {
		const filterContext = context(["抽奖"]);
		filterContext.accountWhitelist = ["@trusted"];
		filterContext.accountBlacklist = ["@trusted"];
		expect(
			classifyArticle(
				{
					body: "抽奖",
					name: "",
					identity: { handle: "trusted" },
				},
				filterContext,
			),
		).toEqual({ hit: null, reason: null, log: null });
	});
});
