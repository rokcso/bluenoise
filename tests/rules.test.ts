import { describe, expect, it } from "vitest";
import { defaultConfig, defaultRuleData } from "@/src/domain/defaults";
import {
	addAccountRule,
	createRuleView,
	loadRuleData,
} from "@/src/domain/rules";

describe("rule data", () => {
	it("keeps user rules and downloaded source snapshots out of settings", () => {
		const settings = defaultConfig();
		const rules = defaultRuleData();
		rules.keywords.user.block = ["local block"];
		rules.keywords.external["x-comment-blocker"] = {
			keywords: ["remote block"],
			syncedAt: 1,
		};
		rules.accounts.user.allow = ["@trusted"];

		const view = createRuleView(settings, rules);
		expect("userKeywords" in settings).toBe(false);
		expect(view.userKeywords).toEqual(["local block"]);
		expect(
			view.subscriptions.find((source) => source.id === "x-comment-blocker")
				?.keywords,
		).toEqual(["remote block"]);
		expect(view.accountWhitelist).toEqual(["@trusted"]);
	});

	it("fills missing rule data branches with empty values", () => {
		expect(
			loadRuleData({ keywords: { user: { block: ["x"] } } }).accounts.user
				.block,
		).toEqual([]);
	});

	it("enables the bundled keyword provider by default", () => {
		expect(defaultConfig().keywordSourceEnabled.bluenoise).toBe(true);
	});

	it("adds an account identity to the selected user list", () => {
		const rules = defaultRuleData();
		rules.keywords.user.block = ["keep me"];

		const next = addAccountRule(rules, "allow", {
			id: "123",
			handle: "fallback",
		});

		expect(next?.accounts.user.allow).toEqual(["123"]);
		expect(next?.accounts.user.block).toEqual([]);
		expect(next?.keywords.user.block).toEqual(["keep me"]);
		expect(rules.accounts.user.allow).toEqual([]);
	});

	it("rejects duplicate and invalid account identities", () => {
		const rules = defaultRuleData();
		rules.accounts.user.block = ["@Existing"];

		expect(addAccountRule(rules, "block", { handle: "existing" })).toBeNull();
		expect(addAccountRule(rules, "block", { handle: "@" })).toBeNull();
	});
});
