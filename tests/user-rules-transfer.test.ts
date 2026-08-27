import { describe, expect, it } from "vitest";
import { defaultRuleData } from "@/src/domain/defaults";
import {
	applyUserRulesImport,
	exportUserRules,
	parseUserRulesImport,
} from "@/src/domain/user-rules-transfer";

describe("user rule transfers", () => {
	it("exports only the four local user lists", () => {
		const data = defaultRuleData();
		data.keywords.user.block = ["local"];
		data.keywords.external["x-comment-blocker"] = {
			keywords: ["remote"],
			syncedAt: 1,
		};
		const exported = exportUserRules(data);
		expect(exported.keywords.block).toEqual(["local"]);
		expect(JSON.stringify(exported)).not.toContain("remote");
	});

	it("validates, normalizes, and previews imports", () => {
		const preview = parseUserRulesImport(
			JSON.stringify({
				schema: 1,
				kind: "bluenoise-user-rules",
				exportedAt: "now",
				keywords: { block: ["Word", "word", "/[bad/"], allow: [] },
				accounts: { block: [" @Spam_Bot", "invalid!"], allow: [] },
			}),
		);
		expect(preview.rules.keywords.block).toEqual(["Word"]);
		expect(preview.rules.accounts.block).toEqual(["@spam_bot"]);
		expect(preview.ignored).toBe(3);
	});

	it("merges or replaces only user branches", () => {
		const current = defaultRuleData();
		current.keywords.user.block = ["old"];
		current.keywords.external["x-comment-blocker"] = {
			keywords: ["remote"],
			syncedAt: 1,
		};
		const incoming = parseUserRulesImport(
			JSON.stringify({
				schema: 1,
				kind: "bluenoise-user-rules",
				keywords: { block: ["new"], allow: [] },
				accounts: { block: [], allow: [] },
			}),
		).rules;
		expect(
			applyUserRulesImport(current, incoming, "merge").keywords.user.block,
		).toEqual(["old", "new"]);
		const replaced = applyUserRulesImport(current, incoming, "replace");
		expect(replaced.keywords.user.block).toEqual(["new"]);
		expect(replaced.keywords.external["x-comment-blocker"]?.keywords).toEqual([
			"remote",
		]);
	});

	it("appends valid duplicate rules when requested", () => {
		const current = defaultRuleData();
		current.keywords.user.block = ["same"];
		const incoming = parseUserRulesImport(
			JSON.stringify({
				schema: 1,
				kind: "bluenoise-user-rules",
				keywords: { block: ["same", "same"], allow: [] },
				accounts: { block: [], allow: [] },
			}),
			{ preserveDuplicates: true },
		).rules;
		expect(
			applyUserRulesImport(current, incoming, "append").keywords.user.block,
		).toEqual(["same", "same", "same"]);
	});
});
