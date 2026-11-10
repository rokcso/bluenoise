import "../src/content/content.css";
import { setLanguage, t } from "@/lib/i18n";
import {
	AI_HIT,
	aiVerdictReason,
	createAiSecondPass,
} from "@/src/content/ai-second-pass";
import type { FilteredLog } from "@/src/content/article-classifier";
import { createBehaviorSource } from "@/src/content/behavior-source";
import { createArticleEvaluator } from "@/src/content/evaluation";
import type {
	BehaviorReasonSignal,
	FilterReason,
} from "@/src/content/filter-reason";
import { createLatestRevision } from "@/src/content/latest-revision";
import { handleContentProcessingError } from "@/src/content/lifecycle";
import birdSvg from "@/src/content/logo-twitter.svg?raw";
import {
	createTweetMarker,
	FILTERED_CLASS,
	HIT_ATTR,
	REASON_CLASS,
} from "@/src/content/marking";
import { createPageMakeoverController } from "@/src/content/page-makeover";
import { mutationMayChangePreset } from "@/src/content/preset-mutation";
import { isPromotedPost } from "@/src/content/promoted";
import { createReplyCountController } from "@/src/content/reply-count";
import { createRevealController } from "@/src/content/reveal";
import {
	countReasonBuckets,
	itemReasonOf,
	scanReport,
} from "@/src/content/scan-report";
import {
	ARTICLE_SEL,
	isFilterablePath,
	isHomePath,
	isMainTweetArticle,
	isStatusPath,
	MENU_OPENER_SEL,
	MENU_SEL,
	REGION_SEL,
	readAuthorIdentity,
	readTextContent,
	rowOf,
	statusIdFromPath,
	TWEET_TEXT_SEL,
	tweetIdOf,
	USER_NAME_SEL,
} from "@/src/content/selectors";
import { drainWithinBudget, type ScanTrigger } from "@/src/content/work-budget";
import type { AiEvaluateResponse } from "@/src/contracts/ai";
import { BEHAVIOR_HISTORY_KEY } from "@/src/contracts/behavior";
import type {
	AppConfig,
	Matchers,
	RuleData,
	RuleView,
} from "@/src/contracts/config";
import { RULE_DATA_KEY, SETTINGS_KEY } from "@/src/contracts/config";
import {
	type DebugLogEntry,
	type DebugLogLevel,
	serializeDebugError,
} from "@/src/contracts/debug-log";
import type { BehaviorVerdict } from "@/src/domain/account-behavior";
import {
	type AccountListIndex,
	type AccountListSnapshot,
	buildAccountListIndex,
	DEFAULT_ACCOUNT_LIST_SOURCES,
	mergeAccountListSnapshots,
} from "@/src/domain/account-list";
import {
	defaultConfig,
	defaultRuleData,
	loadConfig,
} from "@/src/domain/defaults";
import { buildMatchers } from "@/src/domain/matcher";
import {
	addAccountRule,
	createRuleView,
	loadRuleData,
} from "@/src/domain/rules";
import { postedAtFromStatusId } from "@/src/domain/snowflake";

const REVEAL_RADIUS = 40;
const MODE_ATTR = "data-bluenoise-mode";
const INVISIBLE_ATTR = "data-bluenoise-invisible";
const OPACITY_VAR = "--bluenoise-opacity";
const DOM_OWNER_ATTR = "data-bluenoise-owner";

/** X renders async after SPA navigation; rescan at these delays to catch stragglers. */
const RESCAN_DELAYS = [0, 250, 800, 1800, 3500];
/** Beyond this many mutation records per callback, fall back to a full scan. */
const MUTATION_BURST = 800;
/** Keep filtering work below a frame budget so X remains responsive. */
const FLUSH_BUDGET_MS = 8;
const FLUSH_MAX_ARTICLES = 50;
const ACCOUNT_SOURCE_NAMES = new Map(
	DEFAULT_ACCOUNT_LIST_SOURCES.map((source) => [source.id, source.name]),
);
const DEBUG_SESSION_ID = crypto.randomUUID();
let debugSequence = 0;
let nextScanId = 0;

export default defineContentScript({
	matches: ["https://x.com/*", "https://twitter.com/*"],
	runAt: "document_start",
	allFrames: false,
	async main(ctx) {
		document.documentElement.setAttribute(DOM_OWNER_ATTR, DEBUG_SESSION_ID);
		ctx.onInvalidated(teardown);
		hookMessages();
		await init().catch(reportInitError);
	},
});

// ==================== State ====================

let cfg: AppConfig = loadConfig(undefined);
let rules: RuleData = defaultRuleData();
let ruleView: RuleView = createRuleView(cfg, rules);
let matchers: Matchers = {
	plain: [],
	normalization: { caseSensitive: false, ignoreSpaces: true },
	custom: [],
	count: 0,
};
let accountSourceIndexes: { id: string; index: AccountListIndex }[] = [];
let accountListVersion = 0;

/** Whether the current page is filterable: a status (tweet detail) page or the home timeline. */
let active = false;
/** Bumped on config change to invalidate stale results cached by the evaluator. */
let generation = 0;

const pending = new Set<Element>();

let flushScheduled = false;
let rafId = 0;
let flushTimer = 0;
let scheduledScanId = 0;
const scheduledScanTriggers = new Set<ScanTrigger>();
let observer: MutationObserver | null = null;
let cleanupObserver: MutationObserver | null = null;
let cleanupFrame = 0;
let lastUrl = typeof location !== "undefined" ? location.href : "";
const configRevision = createLatestRevision();
const rescanTimers: number[] = [];
let badgeTimer = 0;
let lastBadge = -1;

/** True once the extension context is invalidated (dev-mode reload / update). */
let dead = false;

const revealController = createRevealController({
	filteredClass: FILTERED_CLASS,
	hitAttribute: HIT_ATTR,
	reasonClass: REASON_CLASS,
	radius: REVEAL_RADIUS,
	isEnabled: () =>
		cfg.enabled && active && cfg.mode === "dim" && cfg.revealOnHover,
});

function reportInitError(error: unknown): void {
	handleContentProcessingError(error, teardown, (cause) => {
		console.error("[BlueNoise] Content script initialization failed:", cause);
		debugLog(
			"content.init_failed",
			{ error: serializeDebugError(cause) },
			"error",
		);
	});
}

function debugLog(
	event: string,
	details: Record<string, unknown>,
	level: DebugLogLevel = "info",
): void {
	if (!cfg.debugLogging) return;
	const entry: DebugLogEntry = {
		id: `${DEBUG_SESSION_ID}:${++debugSequence}`,
		timestamp: Date.now(),
		sessionId: DEBUG_SESSION_ID,
		level,
		event,
		context: { path: location.pathname },
		details,
	};
	console[level](`[BlueNoise] ${event}`, details);
	sendToBackground({ type: "BLUENOISE_DEBUG_LOG", entry });
}

function debugConfigSnapshot(
	reason: "initialized" | "enabled" | "changed",
): void {
	debugLog("config.snapshot", {
		reason,
		extensionVersion: chrome.runtime.getManifest().version,
		filtering: active,
		enabled: cfg.enabled,
		mode: cfg.mode,
		dimOpacity: cfg.dimOpacity,
		filters: {
			// Either pass may be on: the two are independent switches.
			aiSecondPass: cfg.aiFilterEnabled || cfg.aiLlmEnabled,
			mediaAds: cfg.filterMediaAds,
			cardAds: cfg.filterCardAds,
			parodyAccounts: cfg.filterParodyAccounts,
			fanAccounts: cfg.filterFanAccounts,
			commentaryAccounts: cfg.filterCommentaryAccounts,
			automatedAccounts: cfg.filterAutomatedAccounts,
		},
		matching: {
			matchNames: cfg.matchNames,
			ignoreSpaces: cfg.ignoreSpaces,
			caseSensitive: cfg.caseSensitive,
			matcherCount: matchers.count,
		},
		sources: {
			keywords: Object.entries(cfg.keywordSourceEnabled)
				.filter(([, enabled]) => enabled)
				.map(([id]) => id),
			accounts: Object.entries(cfg.accountSourceEnabled)
				.filter(([, enabled]) => enabled)
				.map(([id]) => id),
		},
		rules: {
			userKeywords: ruleView.userKeywords.length,
			keywordWhitelist: ruleView.whitelist.length,
			accountBlacklist: ruleView.accountBlacklist.length,
			accountWhitelist: ruleView.accountWhitelist.length,
		},
	});
}

function refreshMatchers(): void {
	ruleView = createRuleView(cfg, rules);
	matchers = buildMatchers({ ...cfg, ...ruleView });
}

// ==================== Route state ====================

function currentStatusId(): string | null {
	return statusIdFromPath(location.pathname);
}

function isStatusPage(): boolean {
	return isStatusPath(location.pathname);
}

/** Home feed — "For You" and "Following" share the /home route. */
function isHomeTimeline(): boolean {
	return isHomePath(location.pathname);
}

function isFilterablePage(): boolean {
	return isFilterablePath(location.pathname);
}

function isMainTweet(article: Element): boolean {
	return isMainTweetArticle(article, currentStatusId());
}

// ==================== Feature controllers ====================

const marker = createTweetMarker({ getConfig: () => cfg });

const replyCounts = createReplyCountController({
	articleSelector: ARTICLE_SEL,
	filteredClass: FILTERED_CLASS,
	isStatusPage,
	isHomeTimeline,
	isMainTweet,
	isPromotedPost,
	rowOf,
});
const pageMakeover = createPageMakeoverController({ birdSvg, isStatusPage });

/** Message the worker and wait for its reply, tolerating a dead context. */
async function sendToBackgroundAsync<T>(message: unknown): Promise<T | null> {
	if (dead) return null;
	try {
		return (await chrome.runtime.sendMessage(message)) as T;
	} catch {
		return null;
	}
}

/** On a status page the post under discussion is context a keyword rule cannot see. */
function aiParentText(): string {
	if (!isStatusPage()) return "";
	const first = document.querySelector(ARTICLE_SEL);
	return first ? readTextContent(first.querySelector(TWEET_TEXT_SEL)) : "";
}

/**
 * Records every reply's post time per account and flags machine-speed replies.
 * Local only: the history never leaves the browser.
 */
/** Hit marker for a reply the behavior source flagged. */
const BEHAVIOR_HIT = "behavior:farm";

/**
 * Turn a verdict into a reason the user can argue with. The strongest signal
 * supplies the wording: it is the one that actually pushed the score over.
 */
function behaviorReason(verdict: BehaviorVerdict): FilterReason {
	const strongest = [...verdict.signals].sort((a, b) => b.weight - a.weight)[0];
	const id = strongest?.id;
	const signal: BehaviorReasonSignal =
		id === "cadence" || id === "regular" ? id : mapBehaviorSignal(id);
	return {
		category: "behavior",
		signal,
		replies: verdict.replies,
		windowSeconds: verdict.windowSeconds,
		...(verdict.medianGapSeconds !== undefined
			? { medianGapSeconds: verdict.medianGapSeconds }
			: {}),
	};
}

/** Signals the reason text can describe; the rest fall back to the burst wording. */
function mapBehaviorSignal(
	id: BehaviorVerdict["signals"][number]["id"] | undefined,
): Extract<BehaviorReasonSignal, "burst" | "flood" | "opening" | "phrase"> {
	if (id === "flood" || id === "opening" || id === "phrase") return id;
	return "burst";
}

const behaviorSource = createBehaviorSource({
	load: () =>
		chrome.storage.local
			.get(BEHAVIOR_HISTORY_KEY)
			.then((stored) => stored[BEHAVIOR_HISTORY_KEY]),
	save: (history) =>
		chrome.storage.local.set({ [BEHAVIOR_HISTORY_KEY]: history }),
	log: (event, details) => debugLog(event, details),
});

const aiSecondPass = createAiSecondPass({
	isDead: () => dead,
	isActive: () =>
		(cfg.aiFilterEnabled || cfg.aiLlmEnabled) && cfg.enabled && active,
	readParentText: aiParentText,
	getGeneration: () => generation,
	send: (message) => sendToBackgroundAsync<AiEvaluateResponse>(message),
	log: (event, details, level) => debugLog(event, details, level),
	verdictHit: AI_HIT,
	applyVerdict: (article, probability) => {
		// Turn the verdict into an ordinary filter hit, so presentation modes,
		// filter reasons, collapsing, and the toolbar count all work unchanged.
		if (
			evaluator.applyExternalHit(article, AI_HIT, aiVerdictReason(probability))
		)
			scheduleBadge();
	},
});

const evaluator = createArticleEvaluator({
	getConfig: () => cfg,
	getMatchers: () => matchers,
	getRuleView: () => ruleView,
	getAccountSourceIndexes: () => accountSourceIndexes,
	accountSourceNames: ACCOUNT_SOURCE_NAMES,
	getGeneration: () => generation,
	getAccountListVersion: () => accountListVersion,
	isMainTweet,
	applyMark: (article, hit, reason) => marker.applyMark(article, hit, reason),
	queueForAi: (article, text) => aiSecondPass.queue(article, text),
	judgeBehavior: ({ article, text, handle }) => {
		if (!cfg.behaviorFilterEnabled || !cfg.enabled) return null;
		if (!handle) return null;
		const at = postedAtFromStatusId(tweetIdOf(article));
		if (!at) return null;
		const verdict = behaviorSource.judge({
			handle,
			at,
			parent: currentStatusId(),
			text,
		});
		if (!verdict) return null;
		return { hit: BEHAVIOR_HIT, reason: behaviorReason(verdict) };
	},
});

/** Effect switch: only touch one attribute and one CSS variable on <html>. */
function applyStyleVars(): void {
	const root = document.documentElement;
	if (!cfg.enabled || !active) {
		root.removeAttribute(MODE_ATTR);
		root.removeAttribute(INVISIBLE_ATTR);
		root.style.removeProperty(OPACITY_VAR);
		revealController.hide();
		return;
	}
	root.setAttribute(MODE_ATTR, cfg.mode);
	root.style.setProperty(OPACITY_VAR, String(cfg.dimOpacity));
	root.removeAttribute(INVISIBLE_ATTR);
	marker.syncInteractivity();
	if (cfg.mode !== "dim" || !cfg.revealOnHover) revealController.hide();
}

/** Change presentation without temporarily restoring every matched post. */
function syncPresentation(): void {
	revealController.hide();
	applyStyleVars();
	for (const article of document.querySelectorAll(ARTICLE_SEL)) {
		const cached = evaluator.cachedMark(article);
		if (cached) marker.applyMark(article, cached.hit, cached.reason);
	}
	scheduleBadge();
}

// ==================== Batch scanning ====================

/** Emit structured entries for each match, followed by a compact batch summary. */
function emitFilteredLogs(scanId: number, logs: FilteredLog[]): void {
	for (const log of logs) {
		debugLog("item.filtered", {
			scanId,
			handle: log.handle,
			accountId: log.id,
			reason: itemReasonOf(log),
			rule: log.rule,
			kind: log.kind,
			source: log.source,
			snippet: log.snippet,
		});
	}
	debugLog("filter.batch", {
		scanId,
		filteredCount: logs.length,
		reasons: countReasonBuckets(logs),
	});
}

function flush(): void {
	if (dead || !active || !cfg.enabled) {
		pending.clear();
		scheduledScanTriggers.clear();
		scheduledScanId = 0;
		return;
	}
	// Take a snapshot so mutations caused while evaluating do not get lost when
	// the current batch is cleared. Any unfinished work is put back below.
	const queue = [...pending];
	pending.clear();
	const scanId = scheduledScanId;
	const triggers = [...scheduledScanTriggers];
	scheduledScanId = 0;
	scheduledScanTriggers.clear();
	const queuedCount = queue.length;
	const logs: FilteredLog[] = [];
	let evaluatedCount = 0;
	let cacheHitCount = 0;
	let filteredCount = 0;
	let mainTweetSkippedCount = 0;
	let noActiveRulesCount = 0;
	let noMatchCount = 0;
	let errorCount = 0;
	const startedAt = performance.now();

	let disconnectedCount = 0;

	const result = drainWithinBudget(queue, {
		budgetMs: FLUSH_BUDGET_MS,
		maxItems: FLUSH_MAX_ARTICLES,
		process(article) {
			if (!article.isConnected) {
				disconnectedCount++;
				return true;
			}
			try {
				const evaluation = evaluator.evaluate(article);
				if (evaluation.fresh) evaluatedCount++;
				if (evaluation.log) logs.push(evaluation.log);
				switch (evaluation.outcome) {
					case "cache-hit":
						cacheHitCount++;
						break;
					case "filtered":
						filteredCount++;
						break;
					case "main-tweet":
						mainTweetSkippedCount++;
						break;
					case "no-active-rules":
						noActiveRulesCount++;
						break;
					case "no-match":
						noMatchCount++;
						break;
				}
			} catch (error) {
				errorCount++;
				const shouldContinue = handleContentProcessingError(
					error,
					teardown,
					(cause) => {
						console.error("[BlueNoise] Failed to process an item:", cause);
						debugLog(
							"item.error",
							{ scanId, error: serializeDebugError(cause) },
							"error",
						);
					},
				);
				if (!shouldContinue) return false;
			}
			return true;
		},
	});

	for (const article of result.remaining) pending.add(article);

	if (logs.length) emitFilteredLogs(scanId, logs);
	debugLog(
		"scan.completed",
		scanReport({
			scanId,
			triggers,
			queuedArticleCount: queuedCount,
			evaluatedCount,
			processedArticleCount: result.processed,
			remainingArticleCount: pending.size,
			durationMs: Math.round(performance.now() - startedAt),
			cacheHitCount,
			filteredCount,
			mainTweetSkippedCount,
			noActiveRulesCount,
			noMatchCount,
			disconnectedCount,
			errorCount,
			totalFilteredOnPage: document.querySelectorAll(`.${FILTERED_CLASS}`)
				.length,
		}),
	);

	if (pending.size) {
		schedule("continuation");
		return;
	}
	// Run after every queued reply has received its filtering mark, so the
	// number mirrors what remains in the conversation rather than X's total.
	if (isStatusPage())
		replyCounts.updateDetail(active && cfg.enabled && cfg.showActualReplyCount);
	else if (isHomeTimeline())
		replyCounts.updateTimeline(
			active && cfg.enabled && cfg.showActualReplyCount,
		);
	scheduleBadge();
}

function runFlush(): void {
	if (!flushScheduled) return;
	flushScheduled = false;
	if (rafId) cancelAnimationFrame(rafId);
	if (flushTimer) clearTimeout(flushTimer);
	rafId = 0;
	flushTimer = 0;
	flush();
}

/** Batch flush: prefer following the render frame (no visual flicker); fall back to a timer in background tabs where rAF is suspended. */
function schedule(trigger: ScanTrigger): number {
	if (dead) return 0;
	scheduledScanTriggers.add(trigger);
	if (flushScheduled) return scheduledScanId;
	flushScheduled = true;
	scheduledScanId = ++nextScanId;
	rafId = requestAnimationFrame(runFlush);
	flushTimer = window.setTimeout(runFlush, 300);
	return scheduledScanId;
}

function queueArticle(node: Node): void {
	if (node.nodeType !== 1) return;
	if (node instanceof Element && node.matches?.(ARTICLE_SEL)) {
		pending.add(node);
		return;
	}
	if (!(node instanceof Element)) return;
	for (const a of node.querySelectorAll(ARTICLE_SEL)) pending.add(a);
}

function markArticleStructureDirty(node: Node): void {
	if (!(node instanceof Element)) return;
	const owner = node.closest(ARTICLE_SEL);
	if (owner) evaluator.markStructureDirty(owner);
	for (const article of node.querySelectorAll(ARTICLE_SEL))
		evaluator.markStructureDirty(article);
}

function fullScan(
	trigger: ScanTrigger,
	options: { markTextDirty?: boolean } = {},
): void {
	if (!active || !cfg.enabled) return;
	let articleCount = 0;
	for (const a of document.querySelectorAll(ARTICLE_SEL)) {
		articleCount++;
		if (options.markTextDirty) evaluator.markTextDirty(a);
		pending.add(a);
	}
	const scanId = schedule(trigger);
	debugLog("scan.queued", { scanId, trigger, articleCount });
}

// ==================== Incremental observation ====================

function onMutations(records: MutationRecord[]): void {
	// Content scripts run in an isolated world, so wrapping history.pushState is
	// not sufficient to observe X's own SPA navigation. Any route change also
	// changes the page DOM; notice it before processing stale rows.
	if (refreshForUrlChange()) return;
	if (!active || !cfg.enabled) return;
	if (records.length > MUTATION_BURST) {
		// The per-record dirty check below is deliberately skipped for a burst.
		// Force existing rows through text extraction so content updates cannot be
		// mistaken for a clean cache hit when the full scan drains the queue.
		fullScan("mutation-burst", { markTextDirty: true });
		return;
	}
	let conversationChanged = false;
	for (const rec of records) {
		for (const node of rec.addedNodes) queueArticle(node);
		// An existing wrapper can become a promotion container by receiving
		// data-testid after its article is mounted; queue descendant articles too.
		if (rec.type === "attributes") queueArticle(rec.target);
		const target = rec.target;
		// Text updates inside an existing tweet are reported against the text node.
		// Resolve both element and text-node targets back to their containing article.
		const targetElement =
			target.nodeType === Node.ELEMENT_NODE
				? (target as Element)
				: target.parentElement;
		const article = targetElement?.closest(ARTICLE_SEL);
		if (mutationMayChangePreset(rec)) {
			markArticleStructureDirty(targetElement ?? rec.target);
			for (const node of rec.addedNodes) markArticleStructureDirty(node);
		}
		if (article) {
			pending.add(article);
			// A childList target can be the article itself when X replaces the
			// text container, so inspect added nodes as well as the target.
			const textChanged = Boolean(
				targetElement?.closest(`${TWEET_TEXT_SEL}, ${USER_NAME_SEL}`) ??
					((targetElement?.matches(ARTICLE_SEL) &&
						[...rec.addedNodes].some(
							(node) => node.nodeType === Node.TEXT_NODE,
						)) ||
						[...rec.addedNodes].some(
							(node) =>
								node.nodeType === Node.ELEMENT_NODE &&
								((node as Element).matches(
									`${TWEET_TEXT_SEL}, ${USER_NAME_SEL}`,
								) ||
									(node as Element).querySelector(
										`${TWEET_TEXT_SEL}, ${USER_NAME_SEL}`,
									)),
						)),
			);
			if (textChanged) evaluator.markTextDirty(article);
		}
		if (rec.type === "childList" && targetElement?.closest(REGION_SEL))
			conversationChanged = true;
	}
	if (pending.size || conversationChanged) schedule("mutation");
}

/** Page cleanup has its own observer so filtering mutations do not run global
 * header/sidebar queries on the content-filtering hot path. */
function onCleanupMutations(): void {
	if (!cfg.pageCleanupEnabled) return;
	if (cleanupFrame) return;
	cleanupFrame = requestAnimationFrame(() => {
		cleanupFrame = 0;
		pageMakeover.apply(cfg);
		// Also catch route changes made by X without relying solely on history hooks.
		refreshForUrlChange();
	});
}

function startObserving(): void {
	if (observer) return;
	observer = new MutationObserver(onMutations);
	observer.observe(document.body, {
		childList: true,
		characterData: true,
		// Promotion wrappers are sometimes marked after the article is mounted.
		// Observe only the identifying attribute to avoid X's high-volume class
		// and style mutations.
		attributes: true,
		attributeFilter: ["data-testid"],
		subtree: true,
	});
}

function startCleanupObserving(): void {
	if (cleanupObserver || !cfg.pageCleanupEnabled || !document.body) return;
	cleanupObserver = new MutationObserver(onCleanupMutations);
	cleanupObserver.observe(document.body, {
		childList: true,
		subtree: true,
	});
}

function stopCleanupObserving(): void {
	cleanupObserver?.disconnect();
	cleanupObserver = null;
	if (cleanupFrame) cancelAnimationFrame(cleanupFrame);
	cleanupFrame = 0;
}

// ==================== Badge count ====================

/** Send a message, tolerating an invalidated extension context.
 *  After invalidation Chrome throws synchronously, so a bare `.catch()` on the
 *  returned promise is not enough — the timer/rAF callback would rethrow. */
function sendToBackground(message: unknown): void {
	if (dead) return;
	try {
		chrome.runtime.sendMessage(message).catch(() => {});
	} catch {
		// Extension context invalidated mid-cycle — nothing left to notify.
	}
}

function scheduleBadge(): void {
	if (badgeTimer) return;
	badgeTimer = window.setTimeout(() => {
		badgeTimer = 0;
		const count =
			active && cfg.enabled && cfg.showBadgeCount
				? document.querySelectorAll(`.${FILTERED_CLASS}`).length
				: 0;
		if (count === lastBadge) return;
		lastBadge = count;
		sendToBackground({ type: "BLUENOISE_COUNT", count });
	}, 400);
}

/** Let the popup read the current filtered count on this page. */
function currentFilteredCount(): number {
	return active && cfg.enabled && cfg.showBadgeCount
		? document.querySelectorAll(`.${FILTERED_CLASS}`).length
		: 0;
}

function hookMessages(): void {
	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		try {
			if (message?.type === "BLUENOISE_GET_COUNT") {
				sendResponse({ count: currentFilteredCount() });
			}
		} catch {
			// Context invalidated; drop the message quietly.
		}
	});
}

// ==================== Tweet ⋯ menu injection ====================

const MENU_ITEM_CLASS = "bluenoise-menu-item";
const MENU_ICONS = {
	whitelist:
		"M14 14.252V16.3414C13.3744 16.1203 12.7013 16 12 16C8.68629 16 6 18.6863 6 22H4C4 17.5817 7.58172 14 12 14C12.6906 14 13.3608 14.0875 14 14.252ZM12 13C8.685 13 6 10.315 6 7C6 3.685 8.685 1 12 1C15.315 1 18 3.685 18 7C18 10.315 15.315 13 12 13ZM12 11C14.21 11 16 9.21 16 7C16 4.79 14.21 3 12 3C9.79 3 8 4.79 8 7C8 9.21 9.79 11 12 11ZM17.7929 19.9142L21.3284 16.3787L22.7426 17.7929L17.7929 22.7426L14.2574 19.2071L15.6716 17.7929L17.7929 19.9142Z",
	blacklist:
		"M8 7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7C16 9.20914 14.2091 11 12 11C9.79086 11 8 9.20914 8 7ZM12 1C8.68629 1 6 3.68629 6 7C6 10.3137 8.68629 13 12 13C15.3137 13 18 10.3137 18 7C18 3.68629 15.3137 1 12 1ZM15 18C15 16.3431 16.3431 15 18 15C18.4631 15 18.9018 15.105 19.2934 15.2924L15.2924 19.2934C15.105 18.9018 15 18.4631 15 18ZM16.7066 20.7076L20.7076 16.7066C20.895 17.0982 21 17.5369 21 18C21 19.6569 19.6569 21 18 21C17.5369 21 17.0982 20.895 16.7066 20.7076ZM18 13C15.2386 13 13 15.2386 13 18C13 20.7614 15.2386 23 18 23C20.7614 23 23 20.7614 23 18C23 15.2386 20.7614 13 18 13ZM12 14C12.0843 14 12.1683 14.0013 12.252 14.0039C11.8236 14.6189 11.4914 15.3059 11.2772 16.0431C8.30431 16.4 6 18.9309 6 22H4C4 17.5817 7.58172 14 12 14Z",
} as const;

let menuSourceArticle: Element | null = null;
let menuObserver: MutationObserver | null = null;
let menuTokenTimer = 0;

function nativeMenuHoverColor(template: HTMLElement | null): string {
	if (!template) return "rgba(0, 0, 0, 0.03)";
	const channels = getComputedStyle(template).color.match(/\d+(?:\.\d+)?/g);
	const [red = 0, green = 0, blue = 0] = channels?.map(Number) ?? [];
	const lightText = red + green + blue > 384;
	return lightText ? "rgba(239, 243, 244, 0.1)" : "rgba(0, 0, 0, 0.03)";
}

function buildMenuAction(
	article: Element,
	list: "whitelist" | "blacklist",
	template: HTMLElement | null,
): HTMLElement {
	const label =
		list === "whitelist"
			? t("contextMenu_addToWhitelist")
			: t("contextMenu_addToBlacklist");
	const el = document.createElement("button");
	el.type = "button";
	el.className = template
		? `${template.className} ${MENU_ITEM_CLASS} bluenoise-native-menu-item`
		: MENU_ITEM_CLASS;
	el.setAttribute("role", "menuitem");
	el.tabIndex = 0;
	el.style.setProperty(
		"--bluenoise-menu-hover",
		nativeMenuHoverColor(template),
	);

	if (template) {
		for (const child of template.children) el.append(child.cloneNode(true));
		const icon = el.querySelector("svg");
		const labelNode = el.querySelector("span");
		if (icon && labelNode) {
			icon.replaceChildren();
			const path = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"path",
			);
			path.setAttribute("d", MENU_ICONS[list]);
			icon.append(path);
			labelNode.textContent = label;
		} else {
			el.replaceChildren();
		}
	}

	if (!el.children.length) {
		const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		icon.setAttribute("viewBox", "0 0 24 24");
		icon.setAttribute("aria-hidden", "true");
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", MENU_ICONS[list]);
		icon.append(path);
		const span = document.createElement("span");
		span.textContent = label;
		el.append(icon, span);
	}
	// Do not stopPropagation: React only schedules handlers with fibers, and X's
	// "click outside to close" listener (if any) still needs the event to bubble.
	// Capture the article here (closure), not from the global token at click time:
	// the token is cleared as soon as the menu is injected.
	el.addEventListener("click", () => {
		if (article.isConnected) void addMenuAccount(article, list);
		// Our items aren't in React's event tree, so X won't close the menu for us.
		// Dispatch Escape (bubbles to X's keydown listener) to dismiss it.
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	return el;
}

function injectMenuItems(menu: HTMLElement): void {
	const article = menuSourceArticle;
	// SPA navigation may have detached the tweet while the menu was opening.
	if (!article?.isConnected) {
		hideTweetMenuToken();
		return;
	}
	// X may reuse the same portal; replace old actions so their author closure
	// always matches the tweet that opened this menu.
	for (const oldItem of menu.querySelectorAll(`.${MENU_ITEM_CLASS}`)) {
		oldItem.remove();
	}
	const template = menu.querySelector<HTMLElement>(
		`:scope > [role="menuitem"]:not(.${MENU_ITEM_CLASS})`,
	);
	// Append after X's native items; never add data-testid (see sanitizeRevealClone).
	const whitelist = buildMenuAction(article, "whitelist", template);
	const blacklist = buildMenuAction(article, "blacklist", template);
	menu.append(whitelist, blacklist);
	hideTweetMenuToken();
}

function hideTweetMenuToken(): void {
	menuSourceArticle = null;
	if (menuTokenTimer) window.clearTimeout(menuTokenTimer);
	menuTokenTimer = 0;
}

/** Add the tweet's author to a local account list via storage, deduped. */
async function addMenuAccount(
	article: Element,
	list: "whitelist" | "blacklist",
): Promise<void> {
	const identity = readAuthorIdentity(article, true);
	const result = await chrome.storage.local.get(RULE_DATA_KEY);
	const latest = loadRuleData(result[RULE_DATA_KEY]);
	const field = list === "whitelist" ? "allow" : "block";
	const next = addAccountRule(latest, field, identity);
	if (!next) return;
	await chrome.storage.local.set({ [RULE_DATA_KEY]: next });
	// Writing rule data fires storage.onChanged -> watchConfig -> refresh(),
	// which re-scans and applies the list immediately.
}

function onMenuClickCapture(event: Event): void {
	const target = event.target;
	if (!(target instanceof Element)) return;
	// Only treat a click that opens a role="menu" dropdown (⋯), excluding the
	// share button and tweet body.
	const opener = target.closest(MENU_OPENER_SEL);
	if (!opener) return;
	const article = opener.closest(ARTICLE_SEL);
	if (!article) return;
	hideTweetMenuToken();
	menuSourceArticle = article;
	// Do not let a cancelled/closed menu bind a later dropdown to this tweet.
	menuTokenTimer = window.setTimeout(hideTweetMenuToken, 1500);
}

/** Wire up tweet-menu injection. Call once from init(); works on every X page
 *  regardless of filtering state. */
function hookTweetMenu(): void {
	document.addEventListener("click", onMenuClickCapture, true);
	menuObserver = new MutationObserver((records) => {
		if (!menuSourceArticle) return;
		for (const record of records) {
			for (const node of record.addedNodes) {
				if (!(node instanceof Element)) continue;
				const menu = node.matches(MENU_SEL)
					? node
					: (node.closest(MENU_SEL) ?? node.querySelector(MENU_SEL));
				if (menu instanceof HTMLElement) injectMenuItems(menu);
			}
		}
	});
	menuObserver.observe(document.body, { childList: true, subtree: true });
}

function unhookTweetMenu(): void {
	document.removeEventListener("click", onMenuClickCapture, true);
	menuObserver?.disconnect();
	menuObserver = null;
	hideTweetMenuToken();
}

// ==================== Lifecycle ====================

function clearRescanTimers(): void {
	for (const timer of rescanTimers) clearTimeout(timer);
	rescanTimers.length = 0;
}

function scheduleRescans(trigger: ScanTrigger): void {
	clearRescanTimers();
	for (const delay of RESCAN_DELAYS) {
		rescanTimers.push(
			window.setTimeout(() => {
				fullScan(trigger);
			}, delay),
		);
	}
}

function start(trigger: ScanTrigger): void {
	// Hydrate the per-account history before the first scan so early replies are
	// judged with whatever evidence the previous page views already gathered.
	void behaviorSource.ready();
	startObserving();
	applyStyleVars();
	scheduleRescans(trigger);
}

function stop(): void {
	clearRescanTimers();
	if (flushTimer) clearTimeout(flushTimer);
	if (rafId) cancelAnimationFrame(rafId);
	flushTimer = 0;
	rafId = 0;
	flushScheduled = false;
	pending.clear();
	scheduledScanTriggers.clear();
	scheduledScanId = 0;
	aiSecondPass.clear();
	marker.clearAll();
	replyCounts.clearRendered();
	applyStyleVars();
	scheduleBadge();
}

/**
 * WXT revokes this content script's context when the extension is reloaded or
 * updated. The page and its own listeners stay alive, so any leftover timer,
 * MutationObserver, or DOM listener would keep firing and throw "Extension
 * context invalidated." the next time it touches `chrome.*`. Disconnect
 * everything the moment the context is invalidated so the old instance dies
 * quietly instead of crashing.
 */
function teardown(): void {
	dead = true;
	clearRescanTimers();
	if (flushTimer) clearTimeout(flushTimer);
	if (rafId) cancelAnimationFrame(rafId);
	flushTimer = 0;
	rafId = 0;
	flushScheduled = false;
	scheduledScanTriggers.clear();
	scheduledScanId = 0;
	if (badgeTimer) clearTimeout(badgeTimer);
	badgeTimer = 0;
	aiSecondPass.clear();
	observer?.disconnect();
	observer = null;
	unhookTweetMenu();
	cleanupObserver?.disconnect();
	cleanupObserver = null;
	if (cleanupFrame) cancelAnimationFrame(cleanupFrame);
	cleanupFrame = 0;
	revealController.stop();
	void behaviorSource.flush();
	window.removeEventListener("popstate", onUrlChange);
	window.removeEventListener("pageshow", onPageShow);
	document.removeEventListener("visibilitychange", onVisibility);
	const root = document.documentElement;
	// A newly injected content script claims the document synchronously. An old
	// invalidated instance must never erase the new instance's presentation.
	if (root.getAttribute(DOM_OWNER_ATTR) === DEBUG_SESSION_ID) {
		pageMakeover.reset();
		revealController.hide();
		marker.clearAll();
		root.removeAttribute(MODE_ATTR);
		root.removeAttribute(INVISIBLE_ATTR);
		root.removeAttribute(DOM_OWNER_ATTR);
		root.style.removeProperty(OPACITY_VAR);
	}
	pending.clear();
}

function refresh(options: {
	rebuild?: boolean;
	clearReplyCountCache?: boolean;
	trigger: ScanTrigger;
}): void {
	if (options.rebuild) refreshMatchers();
	if (options.rebuild || options.clearReplyCountCache)
		replyCounts.clearCaches();
	generation++;
	// A visual clone is owned by this script rather than X's virtualized list.
	// It must never survive a SPA route transition.
	revealController.hide();
	pending.clear();
	replyCounts.clearRendered();
	active = isFilterablePage();

	if (!cfg.enabled || !active) {
		stop();
		return;
	}
	marker.clearAll();
	start(options.trigger);
}

/** SPA navigation. Never location.reload() — just re-evaluate and rescan. */
function onUrlChange(): void {
	refreshForUrlChange();
}

function refreshForUrlChange(): boolean {
	if (location.href === lastUrl) return false;
	lastUrl = location.href;
	refresh({ trigger: "navigation" });
	return true;
}

function onPageShow(): void {
	lastUrl = location.href;
	refresh({ trigger: "pageshow" });
}

function waitForBody(): Promise<void> {
	if (document.body) return Promise.resolve();
	return new Promise((resolve) => {
		const observer = new MutationObserver(() => {
			if (!document.body) return;
			observer.disconnect();
			resolve();
		});
		observer.observe(document.documentElement, { childList: true });
	});
}

function hookHistory(): void {
	const wrap = (name: "pushState" | "replaceState") => {
		const original = history[name];
		if (typeof original !== "function") return;
		const wrapped = function (this: History, ...args: unknown[]) {
			const result = (
				original as unknown as (...a: unknown[]) => unknown
			).apply(this, args);
			// pushState/replaceState don't fire popstate — notify ourselves.
			queueMicrotask(onUrlChange);
			return result;
		};
		history[name] = wrapped as typeof original;
	};
	wrap("pushState");
	wrap("replaceState");
	window.addEventListener("popstate", onUrlChange);
	window.addEventListener("pageshow", onPageShow);
}

// ==================== Config ====================

function loadStoredConfig(): Promise<void> {
	return readStoredState().then((stored) => {
		({ cfg, rules } = stored);
		refreshMatchers();
		setLanguage(cfg.language);
	});
}

async function readStoredState(): Promise<{ cfg: AppConfig; rules: RuleData }> {
	const [synced, local] = await Promise.all([
		chrome.storage.sync.get(SETTINGS_KEY),
		chrome.storage.local.get(RULE_DATA_KEY),
	]);
	return {
		cfg: loadConfig(synced[SETTINGS_KEY] ?? defaultConfig()),
		rules: loadRuleData(local[RULE_DATA_KEY] ?? defaultRuleData()),
	};
}

const MATCH_KEYS = [
	"enabled",
	"behaviorFilterEnabled",
	"aiFilterEnabled",
	"aiLlmEnabled",
	// Editing the preference changes the question, so cached verdicts are stale.
	"aiLlmPreference",
	"filterMediaAds",
	"filterCardAds",
	"filterParodyAccounts",
	"filterFanAccounts",
	"filterCommentaryAccounts",
	"filterAutomatedAccounts",
	"matchNames",
	"ignoreSpaces",
	"caseSensitive",
] as const;

function matchingChanged(prev: AppConfig, next: AppConfig): boolean {
	for (const key of MATCH_KEYS) {
		if (prev[key] !== next[key]) return true;
	}
	if (
		JSON.stringify(prev.accountSourceEnabled) !==
		JSON.stringify(next.accountSourceEnabled)
	)
		return true;
	return false;
}

function watchConfig(): void {
	chrome.storage.onChanged.addListener((changes, area) => {
		if (
			(area !== "sync" || !changes[SETTINGS_KEY]) &&
			(area !== "local" || !changes[RULE_DATA_KEY])
		)
			return;
		const prev = cfg;
		const rulesChanged = Boolean(changes[RULE_DATA_KEY]);
		const revision = configRevision.issue();
		void readStoredState().then((stored) => {
			// Rapid UI toggles can resolve storage reads out of order. Only the
			// latest read may mutate the page or schedule scans.
			if (!configRevision.isCurrent(revision)) return;
			({ cfg, rules } = stored);
			updateAccountSources(rules);
			setLanguage(cfg.language);
			pageMakeover.apply(cfg);
			if (cfg.pageCleanupEnabled) startCleanupObserving();
			else stopCleanupObserving();
			const reclassify = rulesChanged || matchingChanged(prev, cfg);
			if (reclassify) {
				refresh({
					rebuild: true,
					trigger: rulesChanged ? "rules-change" : "config-change",
				});
			} else if (
				prev.mode !== cfg.mode ||
				prev.showFilterReason !== cfg.showFilterReason ||
				prev.language !== cfg.language
			) {
				syncPresentation();
			} else {
				applyStyleVars();
			}
			if (prev.showBadgeCount !== cfg.showBadgeCount) scheduleBadge();
			if (!prev.debugLogging && cfg.debugLogging) {
				debugLog("logging.enabled", {
					filtering: active,
					matcherCount: matchers.count,
				});
				debugConfigSnapshot("enabled");
				// Re-evaluate rendered items so the new session includes current matches.
				generation++;
				fullScan("debug-enabled");
			} else if (
				cfg.debugLogging &&
				(rulesChanged || matchingChanged(prev, cfg) || prev.mode !== cfg.mode)
			) {
				debugConfigSnapshot("changed");
			}
		});
		if (prev.showActualReplyCount !== cfg.showActualReplyCount) {
			if (!cfg.showActualReplyCount) replyCounts.clearRendered();
			else if (isHomeTimeline()) replyCounts.updateTimeline(true);
			else replyCounts.updateDetail(true);
		}
	});
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local" || !changes[RULE_DATA_KEY]) return;
		updateAccountSources(loadRuleData(changes[RULE_DATA_KEY].newValue));
		if (cfg.enabled && active)
			refresh({
				clearReplyCountCache: true,
				trigger: "account-list-change",
			});
	});
}

// ==================== Startup ====================

async function init(): Promise<void> {
	await loadStoredConfig();
	// Root-attribute CSS can suppress X's native modules before the account list
	// and body-dependent filtering pipeline is ready.
	pageMakeover.apply(cfg);
	await Promise.all([loadAccountList(), waitForBody()]);
	refreshMatchers();
	watchConfig();
	hookHistory();
	revealController.start();
	// Tweet-menu injection works on every X page, independent of filtering state.
	hookTweetMenu();
	// Keep the observer alive off status pages as well. It is the reliable
	// fallback that notices a later X SPA transition back to a status page.
	startObserving();
	startCleanupObserving();
	pageMakeover.apply(cfg);

	active = isFilterablePage();
	debugLog("content.initialized", {
		filtering: active,
		enabled: cfg.enabled,
		matcherCount: matchers.count,
		userKeywordCount: ruleView.userKeywords.length,
	});
	debugConfigSnapshot("initialized");
	if (cfg.enabled && active) start("initial");
	else applyStyleVars();

	document.addEventListener("visibilitychange", onVisibility);
}

function onVisibility(): void {
	if (!document.hidden) fullScan("visibility");
}

async function loadAccountList(): Promise<void> {
	const result = await chrome.storage.local.get(RULE_DATA_KEY);
	updateAccountSources(loadRuleData(result[RULE_DATA_KEY]));
}

function updateAccountSources(data: RuleData): void {
	accountSourceIndexes = DEFAULT_ACCOUNT_LIST_SOURCES.flatMap((source) => {
		if (!cfg.accountSourceEnabled[source.id]) return [];
		const snapshot = data.accounts.external[source.id];
		return snapshot
			? [{ id: source.id, index: buildAccountListIndex(snapshot) }]
			: [];
	});
	accountListVersion = accountSnapshot(data)?.version ?? 0;
}

function accountSnapshot(data: RuleData): AccountListSnapshot | undefined {
	return mergeAccountListSnapshots(
		DEFAULT_ACCOUNT_LIST_SOURCES.filter(
			(source) => cfg.accountSourceEnabled[source.id],
		)
			.map((source) => data.accounts.external[source.id])
			.filter((snapshot): snapshot is AccountListSnapshot => Boolean(snapshot)),
	);
}
