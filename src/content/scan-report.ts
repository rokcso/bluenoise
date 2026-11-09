/**
 * The structured payloads BlueNoise writes to the debug log.
 *
 * Debug output is the only way to diagnose a user's report after the fact, so
 * its shape is a contract: the counters must stay greppable and the rule
 * content must never leak into it (a debug log is copied into issue reports).
 * Building the objects here — instead of inline in the scan loop — keeps that
 * contract testable.
 */

import type { FilteredLog } from "@/src/content/article-classifier";
import type { ScanTrigger } from "@/src/content/work-budget";

/** Per-batch counters, one `scan.completed` entry per drained queue. */
export interface ScanCounters {
	scanId: number;
	triggers: readonly ScanTrigger[];
	queuedArticleCount: number;
	evaluatedCount: number;
	processedArticleCount: number;
	remainingArticleCount: number;
	durationMs: number;
	cacheHitCount: number;
	filteredCount: number;
	mainTweetSkippedCount: number;
	noActiveRulesCount: number;
	noMatchCount: number;
	disconnectedCount: number;
	errorCount: number;
	totalFilteredOnPage: number;
}

/** Rule counts and flags for a configuration snapshot. */
export interface ConfigSnapshotDetails {
	reason: "initialized" | "enabled" | "changed";
	extensionVersion: string;
	filtering: boolean;
	enabled: boolean;
	mode: string;
	dimOpacity: number;
	filters: Record<string, boolean>;
	matching: Record<string, boolean | number>;
	sources: { keywords: string[]; accounts: string[] };
	rules: {
		userKeywords: number;
		keywordWhitelist: number;
		accountBlacklist: number;
		accountWhitelist: number;
	};
}

/**
 * A rule label that can be aggregated across a batch: `preset:ad`,
 * `account:blacklist`, or `source :: rule`. Exported because the batch summary
 * and the per-item entry must agree on the same classification.
 */
export function ruleBucketOf(log: FilteredLog): string {
	if (log.category === "preset") return `preset:${log.preset}`;
	if (log.category === "account") return "account:blacklist";
	return `${log.source ?? "?"} :: ${log.rule}`;
}

/** Count how often each rule fired, sorted by frequency then label. */
export function countReasonBuckets(
	logs: readonly FilteredLog[],
): Record<string, number> {
	const counts = new Map<string, number>();
	for (const log of logs) {
		const key = ruleBucketOf(log);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return Object.fromEntries(
		[...counts.entries()].sort(
			([aKey, aCount], [bKey, bCount]) =>
				bCount - aCount || aKey.localeCompare(bKey),
		),
	);
}

/** Human-readable reason for a per-item debug entry. */
export function itemReasonOf(log: FilteredLog): string {
	if (log.category === "preset") return `preset:${log.preset}`;
	if (log.category === "account") return "account blacklist";
	return `keyword:${log.field}`;
}

/** The `scan.completed` payload. */
export function scanReport(counters: ScanCounters): Record<string, unknown> {
	return {
		scanId: counters.scanId,
		triggers: [...counters.triggers],
		queuedArticleCount: counters.queuedArticleCount,
		evaluatedCount: counters.evaluatedCount,
		processedArticleCount: counters.processedArticleCount,
		remainingArticleCount: counters.remainingArticleCount,
		durationMs: counters.durationMs,
		cacheHitCount: counters.cacheHitCount,
		filteredCount: counters.filteredCount,
		mainTweetSkippedCount: counters.mainTweetSkippedCount,
		noActiveRulesCount: counters.noActiveRulesCount,
		noMatchCount: counters.noMatchCount,
		disconnectedCount: counters.disconnectedCount,
		errorCount: counters.errorCount,
		totalFilteredOnPage: counters.totalFilteredOnPage,
	};
}
