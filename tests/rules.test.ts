import { describe, expect, it } from "vitest";
import { defaultConfig, defaultRuleData } from "@/src/domain/defaults";
import { createRuleView, loadRuleData } from "@/src/domain/rules";

describe("rule data", () => {
	it("keeps user rules and downloaded source snapshots out of settings", () => {
		const settings = defaultConfig();
		const rules = defaultRuleData();
		rules.keywords.user.block = ["local block"];
		rules.keywords.external.community = {
			keywords: ["remote block"],
			syncedAt: 1,
		};
		rules.accounts.user.allow = ["@trusted"];

		const view = createRuleView(settings, rules);
		expect("userKeywords" in settings).toBe(false);
		expect(view.userKeywords).toEqual(["local block"]);
		expect(
			view.subscriptions.find((source) => source.id === "community")?.keywords,
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
});
