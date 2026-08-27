import { describe, expect, it } from "vitest";
import { formatFilterReason, previewRule } from "@/src/content/filter-reason";

const translate = (key: string, ...args: string[]) =>
	`${key}:${args.join("|")}`;

describe("filter reason", () => {
	it("keeps plain keywords and truncates only long regex rules", () => {
		expect(previewRule("a very long plain keyword", "plain")).toBe(
			"a very long plain keyword",
		);
		expect(previewRule("/abcdefghijklmnop/i", "regex")).toBe("/abcdefghijk...");
		expect(previewRule("/short/i", "regex")).toBe("/short/i");
	});

	it("distinguishes user and external keyword sources", () => {
		expect(
			formatFilterReason(
				{ category: "keyword", kind: "plain", rule: "抽奖", source: "user" },
				translate,
			),
		).toBe("filter_reason_user_keyword:抽奖");
		expect(
			formatFilterReason(
				{
					category: "keyword",
					kind: "plain",
					rule: "抽奖",
					source: "社区词库",
				},
				translate,
			),
		).toBe("filter_reason_external_keyword:社区词库|抽奖");
	});

	it("shows only the source for account matches", () => {
		expect(
			formatFilterReason({ category: "account", source: "user" }, translate),
		).toBe("filter_reason_user_account:");
		expect(
			formatFilterReason(
				{ category: "account", source: "BlueNoise" },
				translate,
			),
		).toBe("filter_reason_external_account:BlueNoise");
	});
});
