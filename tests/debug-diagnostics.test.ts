import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const content = readFileSync(
	new URL("../entrypoints/content.ts", import.meta.url),
	"utf8",
);

describe("content diagnostics", () => {
	it("records a bounded configuration snapshot without raw rule content", () => {
		expect(content).toContain('debugLog("config.snapshot"');
		expect(content).toContain("extensionVersion:");
		expect(content).toContain("mediaAds: cfg.filterMediaAds");
		expect(content).toContain("matcherCount: matchers.count");
		expect(content).toContain("userKeywords: ruleView.userKeywords.length");
		expect(content).not.toContain("userKeywords: ruleView.userKeywords,");
	});

	it("correlates scan triggers, outcomes, and errors with a scan ID", () => {
		expect(content).toContain('schedule("mutation")');
		expect(content).toContain('fullScan("visibility")');
		expect(content).toContain("scanId,");
		expect(content).toContain("triggers,");
		expect(content).toContain("cacheHitCount,");
		expect(content).toContain("mainTweetSkippedCount,");
		expect(content).toContain("noActiveRulesCount,");
		expect(content).toContain("noMatchCount,");
		expect(content).toContain("disconnectedCount,");
		expect(content).toContain("errorCount,");
	});

	it("persists initialization and item processing failures", () => {
		expect(content).toContain('"content.init_failed"');
		expect(content).toContain('"item.error"');
		expect(content).toContain('"error",');
	});
});
