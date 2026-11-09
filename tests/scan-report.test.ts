import { describe, expect, it } from "vitest";
import type { FilteredLog } from "@/src/content/article-classifier";
import {
	countReasonBuckets,
	itemReasonOf,
	ruleBucketOf,
	scanReport,
} from "@/src/content/scan-report";

const keywordHit: FilteredLog = {
	category: "keyword",
	field: "body",
	rule: "加微信",
	source: "官方词库",
	kind: "plain",
	handle: "spam",
};

describe("scan report", () => {
	it("keeps every counter the debug log promises", () => {
		const report = scanReport({
			scanId: 7,
			triggers: ["mutation", "continuation"],
			queuedArticleCount: 12,
			evaluatedCount: 5,
			processedArticleCount: 12,
			remainingArticleCount: 0,
			durationMs: 3,
			cacheHitCount: 6,
			filteredCount: 1,
			mainTweetSkippedCount: 1,
			noActiveRulesCount: 0,
			noMatchCount: 4,
			disconnectedCount: 0,
			errorCount: 0,
			totalFilteredOnPage: 9,
		});

		expect(Object.keys(report).sort()).toEqual(
			[
				"cacheHitCount",
				"disconnectedCount",
				"durationMs",
				"errorCount",
				"evaluatedCount",
				"filteredCount",
				"mainTweetSkippedCount",
				"noActiveRulesCount",
				"noMatchCount",
				"processedArticleCount",
				"queuedArticleCount",
				"remainingArticleCount",
				"scanId",
				"totalFilteredOnPage",
				"triggers",
			].sort(),
		);
		expect(report.scanId).toBe(7);
		expect(report.triggers).toEqual(["mutation", "continuation"]);
	});

	it("copies the trigger list so a later mutation cannot rewrite history", () => {
		const triggers: ("mutation" | "pageshow")[] = ["mutation"];
		const report = scanReport({
			scanId: 1,
			triggers,
			queuedArticleCount: 0,
			evaluatedCount: 0,
			processedArticleCount: 0,
			remainingArticleCount: 0,
			durationMs: 0,
			cacheHitCount: 0,
			filteredCount: 0,
			mainTweetSkippedCount: 0,
			noActiveRulesCount: 0,
			noMatchCount: 0,
			disconnectedCount: 0,
			errorCount: 0,
			totalFilteredOnPage: 0,
		});

		triggers.push("pageshow");

		expect(report.triggers).toEqual(["mutation"]);
	});

	it("names a reason the same way for one item and for the batch", () => {
		expect(itemReasonOf(keywordHit)).toBe("keyword:body");
		expect(ruleBucketOf(keywordHit)).toBe("官方词库 :: 加微信");
	});

	it("labels preset and account hits distinctly", () => {
		expect(ruleBucketOf({ category: "preset", preset: "ad" })).toBe(
			"preset:ad",
		);
		expect(itemReasonOf({ category: "preset", preset: "ad" })).toBe(
			"preset:ad",
		);
		expect(ruleBucketOf({ category: "account" })).toBe("account:blacklist");
		expect(itemReasonOf({ category: "account" })).toBe("account blacklist");
	});

	it("aggregates a batch by frequency, then by label", () => {
		const logs: FilteredLog[] = [
			keywordHit,
			{ ...keywordHit, rule: "领福利" },
			{ ...keywordHit, rule: "领福利" },
			{ category: "preset", preset: "ad" },
		];

		expect(countReasonBuckets(logs)).toEqual({
			"官方词库 :: 领福利": 2,
			"preset:ad": 1,
			"官方词库 :: 加微信": 1,
		});
	});

	it("is stable when two rules tie on frequency", () => {
		const logs: FilteredLog[] = [
			{ ...keywordHit, rule: "b" },
			{ ...keywordHit, rule: "a" },
		];

		expect(Object.keys(countReasonBuckets(logs))).toEqual([
			"官方词库 :: a",
			"官方词库 :: b",
		]);
	});

	it("never includes the matched text itself", () => {
		const report = scanReport({
			scanId: 1,
			triggers: [],
			queuedArticleCount: 0,
			evaluatedCount: 0,
			processedArticleCount: 0,
			remainingArticleCount: 0,
			durationMs: 0,
			cacheHitCount: 0,
			filteredCount: 1,
			mainTweetSkippedCount: 0,
			noActiveRulesCount: 0,
			noMatchCount: 0,
			disconnectedCount: 0,
			errorCount: 0,
			totalFilteredOnPage: 1,
		});

		// The report is copied into issue reports; rule *content* must not travel
		// with it, only counts. The per-item entries carry the rule name.
		expect(JSON.stringify(report)).not.toContain("加微信");
	});
});
