import "../src/content/content.css";
import { setLanguage, t } from "@/lib/i18n";
import {
	classifyArticle,
	type FilteredLog,
} from "@/src/content/article-classifier";
import { readFiberUserId } from "@/src/content/fiber";
import {
	type FilterReason,
	formatFilterReason,
} from "@/src/content/filter-reason";
import birdSvg from "@/src/content/logo-twitter.svg?raw";
import { createPageMakeoverController } from "@/src/content/page-makeover";
import { isPromotedPost } from "@/src/content/promoted";
import { createReplyCountController } from "@/src/content/reply-count";
import { createRevealController } from "@/src/content/reveal";
import type {
	AppConfig,
	Matchers,
	RuleData,
	RuleView,
} from "@/src/contracts/config";
import { RULE_DATA_KEY, SETTINGS_KEY } from "@/src/contracts/config";
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

const ARTICLE_SEL = 'article[data-testid="tweet"], article[role="article"]';
const CELL_SEL = 'div[data-testid="cellInnerDiv"]';
const TEXT_SEL = '[data-testid="tweetText"], [data-testid="postText"]';
const NAME_SEL = '[data-testid="User-Name"], [data-testid="userName"]';

const HIT_CLASS = "xsf-filtered";
const SEP = "\u001f";
const HIT_ATTR = "data-xsf-keyword";
const REASON_CLASS = "xsf-filter-reason";
const INERT_ATTR = "data-xsf-inert";
const MODE_ATTR = "data-xsf-mode";
const INVISIBLE_ATTR = "data-xsf-invisible";
const OPACITY_VAR = "--xsf-opacity";
const DIM_OPACITY = 0.15;
const REVEAL_RADIUS = 40;

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

export default defineContentScript({
	matches: ["https://x.com/*", "https://twitter.com/*"],
	runAt: "document_start",
	allFrames: false,
	async main(ctx) {
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
/** Bumped on config change to invalidate stale results cached in the WeakMap. */
let generation = 0;

const state = new WeakMap<
	Element,
	{
		sig: string;
		hit: string | null;
		reason: FilterReason | null;
		log: FilteredLog | null;
	}
>();
const pending = new Set<Element>();
/** Articles whose text/name subtree changed since the last evaluation. */
const textDirty = new WeakSet<Element>();

let flushScheduled = false;
let rafId = 0;
let flushTimer = 0;
let observer: MutationObserver | null = null;
let cleanupObserver: MutationObserver | null = null;
let lastUrl = typeof location !== "undefined" ? location.href : "";
const rescanTimers: number[] = [];
let badgeTimer = 0;
let lastBadge = -1;
const revealController = createRevealController({
	filteredClass: HIT_CLASS,
	hitAttribute: HIT_ATTR,
	reasonClass: REASON_CLASS,
	radius: REVEAL_RADIUS,
	isEnabled: () =>
		cfg.enabled && active && cfg.mode === "dim" && cfg.revealOnHover,
});
function reportInitError(error: unknown): void {
	console.error("[BlueNoise] Content script initialization failed:", error);
}

function debugLog(message: string, details: Record<string, unknown>): void {
	if (cfg.debugLogging) console.info(`[BlueNoise] ${message}`, details);
}

function refreshMatchers(): void {
	ruleView = createRuleView(cfg, rules);
	matchers = buildMatchers({ ...cfg, ...ruleView });
}

function clearAllMarks(): void {
	for (const el of document.querySelectorAll(`.${HIT_CLASS}`)) {
		el.classList.remove(HIT_CLASS);
		el.removeAttribute(HIT_ATTR);
		el.querySelector(`:scope > .${REASON_CLASS}`)?.remove();
		setRowInert(el, false);
	}
}

/**
 * X can keep a profile link focused while its virtualized row is removed.
 * Move focus out first, then make the row inert so X cannot hide focused
 * content from assistive technology during its next reconciliation.
 */
function setRowInert(row: Element, inert: boolean): void {
	const el = row as HTMLElement;
	if (inert) {
		const focused = document.activeElement;
		if (focused instanceof HTMLElement && row.contains(focused)) focused.blur();
		el.inert = true;
		el.setAttribute(INERT_ATTR, "");
		return;
	}
	if (!el.hasAttribute(INERT_ATTR)) return;
	el.inert = false;
	el.removeAttribute(INERT_ATTR);
}

// ==================== DOM reading ====================

/** Read text, newlines and image alts in DOM order for accurate matching. */
function readText(el: Element | null): string {
	if (!el) return "";
	let text = "";
	const walker = document.createTreeWalker(
		el,
		NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
	);
	let node: Node | null = walker.currentNode;
	while (node) {
		if (node.nodeType === Node.TEXT_NODE) {
			text += node.textContent ?? "";
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			const tagName = (node as Element).tagName.toLowerCase();
			if (["br", "div", "p"].includes(tagName)) {
				if (text && !text.endsWith("\n")) text += "\n";
			} else if (tagName === "img") {
				text += (node as Element).getAttribute("alt") ?? "";
			}
		}
		node = walker.nextNode();
	}
	return text;
}

function currentStatusId(): string | null {
	const m = location.pathname.match(/^\/[^/]+\/status\/(\d+)/);
	return m ? m[1] : null;
}

function isStatusPage(): boolean {
	return currentStatusId() !== null;
}

/** Home feed — "For You" and "Following" share the /home route. */
function isHomeTimeline(): boolean {
	return location.pathname === "/home";
}

/** Pages where filtering applies: tweet detail pages and the home timeline. */
function isFilterablePage(): boolean {
	return isStatusPage() || isHomeTimeline();
}

/** The main tweet (the one you opened) is never filtered — only replies are.
 *  This exemption only exists on status pages; on the home timeline every
 *  tweet is a filtering candidate. */
function isMainTweet(article: Element): boolean {
	if (!isStatusPage()) return false;
	const id = currentStatusId();
	if (id) {
		const links = article.querySelectorAll('a[href*="/status/"]');
		for (const a of links) {
			const m = (a.getAttribute("href") ?? "").match(/\/status\/(\d+)/);
			if (m && m[1] === id) return true;
		}
	}
	return article === document.querySelector(ARTICLE_SEL);
}

// ==================== Marking & styling ====================

function rowOf(article: Element): Element {
	return article.closest(CELL_SEL) ?? article;
}

const replyCounts = createReplyCountController({
	articleSelector: ARTICLE_SEL,
	filteredClass: HIT_CLASS,
	isStatusPage,
	isHomeTimeline,
	isMainTweet,
	isPromotedPost,
	rowOf,
});
const pageMakeover = createPageMakeoverController({ birdSvg, isStatusPage });

function applyMark(
	article: Element,
	hit: string | null,
	reason: FilterReason | null = null,
): void {
	const row = rowOf(article);
	if (hit) {
		setRowInert(row, cfg.mode === "hide");
		row.classList.add(HIT_CLASS);
		row.setAttribute(HIT_ATTR, hit);
		let label = row.querySelector<HTMLElement>(`:scope > .${REASON_CLASS}`);
		if (reason && cfg.mode === "dim" && cfg.showFilterReason) {
			const detail = formatFilterReason(reason, t);
			const text = t("filter_reason_label", detail);
			if (!label) {
				label = document.createElement("div");
				label.className = REASON_CLASS;
				row.append(label);
			}
			label.textContent = text;
			label.title = text;
		} else {
			label?.remove();
		}
	} else if (row.classList.contains(HIT_CLASS)) {
		row.classList.remove(HIT_CLASS);
		row.removeAttribute(HIT_ATTR);
		row.querySelector(`:scope > .${REASON_CLASS}`)?.remove();
		setRowInert(row, false);
	}
}

function isMediaAd(article: Element): boolean {
	return (
		isPromotedPost(article) &&
		Boolean(
			article.querySelector(
				'[data-testid="videoPlayer"], [data-testid="tweetPhoto"]',
			),
		)
	);
}

function isCardAd(article: Element): boolean {
	return (
		isPromotedPost(article) &&
		Boolean(article.querySelector('[data-testid="card.wrapper"]'))
	);
}

function readPresetFilter(
	article: Element,
): "ad" | "parody" | "fan" | "commentary" | "automated" | undefined {
	let preset: ReturnType<typeof readPresetFilter>;
	if (
		(cfg.filterAds && isPromotedPost(article)) ||
		(cfg.filterMediaAds && isMediaAd(article)) ||
		(cfg.filterCardAds && isCardAd(article))
	)
		preset = "ad";
	if (cfg.filterParodyAccounts && isParodyAccount(article)) preset = "parody";
	if (cfg.filterFanAccounts && isFanAccount(article)) preset = "fan";
	if (cfg.filterCommentaryAccounts && isCommentaryAccount(article))
		preset = "commentary";
	if (cfg.filterAutomatedAccounts && isAutomatedAccount(article))
		preset = "automated";
	return preset;
}

/** Read X's localized account label from its official authenticity link. */
function getAccountLabel(article: Element): string {
	return (
		article
			.querySelector(
				'a[href="https://help.x.com/rules-and-policies/authenticity"]',
			)
			?.textContent?.trim() ?? ""
	);
}

function isParodyAccount(article: Element): boolean {
	return /^(戏仿账号|parody account)$/i.test(getAccountLabel(article));
}

function isFanAccount(article: Element): boolean {
	return /^(粉丝账号|fan account)$/i.test(getAccountLabel(article));
}

function isCommentaryAccount(article: Element): boolean {
	return /^(评论账号|评论性账号|commentary account)$/i.test(
		getAccountLabel(article),
	);
}

/** X displays this account status beside the author handle. */
function isAutomatedAccount(article: Element): boolean {
	const name = article.querySelector(NAME_SEL);
	return /自动发推|automated account/i.test(name?.textContent ?? "");
}

function syncMarkedRowsInteractivity(): void {
	for (const row of document.querySelectorAll(`.${HIT_CLASS}`)) {
		setRowInert(row, cfg.mode === "hide");
	}
}

/** Effect switch: only touch one attribute and one CSS variable on <html>. */
function applyStyleVars(): void {
	const root = document.documentElement;
	pageMakeover.apply(cfg);
	if (!cfg.enabled || !active) {
		root.removeAttribute(INVISIBLE_ATTR);
		revealController.hide();
		return;
	}
	root.setAttribute(MODE_ATTR, cfg.mode === "hide" ? "hide" : "dim");
	root.style.setProperty(OPACITY_VAR, String(DIM_OPACITY));
	root.removeAttribute(INVISIBLE_ATTR);
	syncMarkedRowsInteractivity();
	if (cfg.mode !== "dim" || !cfg.revealOnHover) revealController.hide();
}

// ==================== Evaluation ====================

function evaluate(article: Element): {
	fresh: boolean;
	log: FilteredLog | null;
} {
	const cached = state.get(article);
	// Most mutations X emits are layout or accessibility updates. If the rule
	// generation is unchanged and neither matching subtree is dirty, avoid the
	// expensive TreeWalker pass entirely.
	if (
		cached &&
		!textDirty.has(article) &&
		cached.sig.startsWith(`${generation}${SEP}${accountListVersion}${SEP}`)
	) {
		applyMark(article, cached.hit, cached.reason);
		return { fresh: false, log: null };
	}
	textDirty.delete(article);
	const text = readText(article.querySelector(TEXT_SEL));
	const name = cfg.matchNames ? readText(article.querySelector(NAME_SEL)) : "";
	const sig = [generation, accountListVersion, text, name].join(SEP);

	if (cached && cached.sig === sig) {
		applyMark(article, cached.hit, cached.reason);
		return { fresh: false, log: null };
	}

	// Account matching needs the numeric user id (React internals); keyword
	// matching only needs the @handle from the DOM.
	const externalAccountSourcesActive = Object.values(
		cfg.accountSourceEnabled,
	).some(Boolean);
	const accountListsActive =
		externalAccountSourcesActive ||
		ruleView.accountWhitelist.length > 0 ||
		ruleView.accountBlacklist.length > 0;

	let decision = { hit: null, reason: null, log: null } as ReturnType<
		typeof classifyArticle
	>;
	if (
		!isMainTweet(article) &&
		(matchers.count > 0 ||
			accountListsActive ||
			cfg.filterAds ||
			cfg.filterMediaAds ||
			cfg.filterCardAds ||
			cfg.filterParodyAccounts ||
			cfg.filterFanAccounts ||
			cfg.filterCommentaryAccounts ||
			cfg.filterAutomatedAccounts)
	) {
		const preset = readPresetFilter(article);
		decision = classifyArticle(
			{
				body: text,
				name,
				identity: preset ? {} : readAuthorIdentity(article, accountListsActive),
				preset,
			},
			{
				matchers,
				accountSources: externalAccountSourcesActive
					? accountSourceIndexes
					: [],
				accountWhitelist: ruleView.accountWhitelist,
				accountBlacklist: ruleView.accountBlacklist,
				accountSourceNames: ACCOUNT_SOURCE_NAMES,
				debugLogging: cfg.debugLogging,
			},
		);
	}

	state.set(article, { sig, ...decision });
	applyMark(article, decision.hit, decision.reason);
	return { fresh: true, log: decision.log };
}

/** One readable log line per filtered reply, then a reason breakdown. */
function emitFilteredLogs(logs: FilteredLog[]): void {
	const reasonCount = new Map<string, number>();
	for (const log of logs) {
		const key =
			log.category === "account"
				? "account:blacklist"
				: `${log.source ?? "?"} :: ${log.rule}`;
		reasonCount.set(key, (reasonCount.get(key) ?? 0) + 1);
	}

	console.group?.(`[BlueNoise] Filtered ${logs.length} item(s)`);
	for (const log of logs) {
		console.info(
			`[BlueNoise] filtered @${log.handle ?? "?"}${
				log.id ? ` (id ${log.id})` : ""
			}`,
			{
				reason:
					log.category === "account"
						? "account blacklist"
						: `keyword:${log.field}`,
				rule: log.rule,
				kind: log.kind,
				source: log.source,
				snippet: log.snippet,
			},
		);
	}
	console.info(
		"[BlueNoise] reason breakdown",
		Object.fromEntries([...reasonCount.entries()].sort((a, b) => b[1] - a[1])),
	);
	console.groupEnd?.();
}

function readAuthorIdentity(
	article: Element,
	needId: boolean,
): {
	id?: string;
	handle?: string;
} {
	const name = article.querySelector(NAME_SEL);
	let handle: string | undefined;
	for (const link of name?.querySelectorAll<HTMLAnchorElement>(
		'a[href^="/"]',
	) ?? []) {
		const path = link.getAttribute("href")?.split("/").filter(Boolean);
		if (path?.length === 1 && /^[A-Za-z0-9_]{1,15}$/.test(path[0] ?? "")) {
			handle = path[0];
			break;
		}
	}
	// X does not expose the numeric user id in the DOM (no `data-user-id`); read
	// it from React internals so account filtering survives @handle renames
	// (mirrors MXGA). The fiber walk is budgeted but not free — skip it for
	// keyword-only setups, where the cheap DOM reads below are enough.
	const fiberId = needId ? readFiberUserId(article, handle) : undefined;
	const attrId =
		article.getAttribute("data-user-id") ??
		name?.getAttribute("data-user-id") ??
		name
			?.querySelector<HTMLElement>("[data-user-id]")
			?.getAttribute("data-user-id") ??
		undefined;
	const id = fiberId ?? attrId;
	return { id: id && /^\d+$/.test(id) ? id : undefined, handle };
}

function flush(): void {
	if (!active || !cfg.enabled) {
		pending.clear();
		return;
	}
	// Take a snapshot so mutations caused while evaluating do not get lost when
	// the current batch is cleared. Any unfinished work is put back below.
	const queue = [...pending];
	pending.clear();
	const queuedCount = queue.length;
	const logs: FilteredLog[] = [];
	let evaluatedCount = 0;
	const startedAt = performance.now();
	let processed = 0;
	for (let i = 0; i < queue.length; i++) {
		const article = queue[i];
		if (!article.isConnected) continue;
		try {
			const result = evaluate(article);
			if (result.fresh) evaluatedCount++;
			if (result.log) logs.push(result.log);
		} catch (error) {
			console.error("[BlueNoise] Failed to process an item:", error);
		}
		processed++;
		// Always make progress on at least one article, even if one unusually
		// complex rule consumes the whole budget by itself.
		if (
			processed >= FLUSH_MAX_ARTICLES ||
			(processed > 0 && performance.now() - startedAt >= FLUSH_BUDGET_MS)
		) {
			for (let rest = i + 1; rest < queue.length; rest++)
				pending.add(queue[rest]);
			break;
		}
	}
	debugLog("Scan completed", {
		queuedArticleCount: queuedCount,
		evaluatedCount,
		processedArticleCount: processed,
		remainingArticleCount: pending.size,
		durationMs: Math.round(performance.now() - startedAt),
		filteredCount: document.querySelectorAll(`.${HIT_CLASS}`).length,
	});
	if (logs.length) emitFilteredLogs(logs);
	if (pending.size) {
		schedule();
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
function schedule(): void {
	if (flushScheduled) return;
	flushScheduled = true;
	rafId = requestAnimationFrame(runFlush);
	flushTimer = window.setTimeout(runFlush, 300);
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

function fullScan(options: { markTextDirty?: boolean } = {}): void {
	if (!active || !cfg.enabled) return;
	let articleCount = 0;
	for (const a of document.querySelectorAll(ARTICLE_SEL)) {
		articleCount++;
		if (options.markTextDirty) textDirty.add(a);
		pending.add(a);
	}
	debugLog("Scan queued", { articleCount });
	schedule();
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
		fullScan({ markTextDirty: true });
		return;
	}
	let conversationChanged = false;
	for (const rec of records) {
		for (const node of rec.addedNodes) queueArticle(node);
		const target = rec.target;
		// Text updates inside an existing tweet are reported against the text node.
		// Resolve both element and text-node targets back to their containing article.
		const targetElement =
			target.nodeType === Node.ELEMENT_NODE
				? (target as Element)
				: target.parentElement;
		const article = targetElement?.closest(ARTICLE_SEL);
		if (article) {
			pending.add(article);
			// A childList target can be the article itself when X replaces the
			// text container, so inspect added nodes as well as the target.
			const textChanged = Boolean(
				targetElement?.closest(`${TEXT_SEL}, ${NAME_SEL}`) ??
					((targetElement?.matches(ARTICLE_SEL) &&
						[...rec.addedNodes].some(
							(node) => node.nodeType === Node.TEXT_NODE,
						)) ||
						[...rec.addedNodes].some(
							(node) =>
								node.nodeType === Node.ELEMENT_NODE &&
								((node as Element).matches(`${TEXT_SEL}, ${NAME_SEL}`) ||
									(node as Element).querySelector(`${TEXT_SEL}, ${NAME_SEL}`)),
						)),
			);
			if (textChanged) textDirty.add(article);
		}
		if (
			rec.type === "childList" &&
			targetElement?.closest('section[role="region"]')
		)
			conversationChanged = true;
	}
	if (pending.size || conversationChanged) schedule();
}

/** Page cleanup has its own observer so filtering mutations do not run global
 * header/sidebar queries on the content-filtering hot path. */
function onCleanupMutations(): void {
	if (!cfg.pageCleanupEnabled) return;
	pageMakeover.apply(cfg);
	// Also catch route changes made by X without relying solely on history hooks.
	refreshForUrlChange();
}

function startObserving(): void {
	if (observer) return;
	observer = new MutationObserver(onMutations);
	observer.observe(document.body, {
		childList: true,
		characterData: true,
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
}

// ==================== Badge count ====================

/** True once the extension context is invalidated (dev-mode reload / update). */
let dead = false;

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
				? document.querySelectorAll(`.${HIT_CLASS}`).length
				: 0;
		if (count === lastBadge) return;
		lastBadge = count;
		sendToBackground({ type: "XSF_COUNT", count });
	}, 400);
}

/** Let the popup read the current filtered count on this page. */
function currentFilteredCount(): number {
	return active && cfg.enabled && cfg.showBadgeCount
		? document.querySelectorAll(`.${HIT_CLASS}`).length
		: 0;
}

function hookMessages(): void {
	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		try {
			if (message?.type === "XSF_GET_COUNT") {
				sendResponse({ count: currentFilteredCount() });
			}
		} catch {
			// Context invalidated; drop the message quietly.
		}
	});
}

// ==================== Tweet ⋯ menu injection ====================

/** X renders dropdowns in a portal, so remember which tweet opened the menu. */
const MENU_SEL = '[data-testid="Dropdown"]';
/** X's per-post overflow button. Stable and not localized. */
const MENU_OPENER_SEL = '[data-testid="caret"][aria-haspopup="menu"]';
const MENU_ITEM_CLASS = "xsf-menu-item";
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
		? `${template.className} ${MENU_ITEM_CLASS} xsf-native-menu-item`
		: MENU_ITEM_CLASS;
	el.setAttribute("role", "menuitem");
	el.tabIndex = 0;
	el.style.setProperty("--xsf-menu-hover", nativeMenuHoverColor(template));

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

function scheduleRescans(): void {
	clearRescanTimers();
	for (const delay of RESCAN_DELAYS) {
		rescanTimers.push(
			window.setTimeout(() => {
				pageMakeover.apply(cfg);
				fullScan();
			}, delay),
		);
	}
}

function start(): void {
	startObserving();
	applyStyleVars();
	scheduleRescans();
}

function stop(): void {
	clearRescanTimers();
	pending.clear();
	clearAllMarks();
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
	if (badgeTimer) clearTimeout(badgeTimer);
	badgeTimer = 0;
	observer?.disconnect();
	observer = null;
	unhookTweetMenu();
	cleanupObserver?.disconnect();
	cleanupObserver = null;
	revealController.stop();
	window.removeEventListener("popstate", onUrlChange);
	window.removeEventListener("pageshow", onPageShow);
	document.removeEventListener("visibilitychange", onVisibility);
	pageMakeover.reset();
	revealController.hide();
	pending.clear();
}

function refresh(
	options: { rebuild?: boolean; clearReplyCountCache?: boolean } = {},
): void {
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
	clearAllMarks();
	start();
}

/** SPA navigation. Never location.reload() — just re-evaluate and rescan. */
function onUrlChange(): void {
	refreshForUrlChange();
}

function refreshForUrlChange(): boolean {
	if (location.href === lastUrl) return false;
	lastUrl = location.href;
	refresh();
	return true;
}

function onPageShow(): void {
	lastUrl = location.href;
	refresh();
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
			// pushState/replaceState don't fire popstate — notify ourselves
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
	return readStoredState().then(() => {
		refreshMatchers();
		setLanguage(cfg.language);
	});
}

async function readStoredState(): Promise<void> {
	const [synced, local] = await Promise.all([
		chrome.storage.sync.get(SETTINGS_KEY),
		chrome.storage.local.get(RULE_DATA_KEY),
	]);
	cfg = loadConfig(synced[SETTINGS_KEY] ?? defaultConfig());
	rules = loadRuleData(local[RULE_DATA_KEY] ?? defaultRuleData());
}

const MATCH_KEYS = [
	"enabled",
	"filterAds",
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
		void readStoredState().then(() => {
			updateAccountSources(rules);
			setLanguage(cfg.language);
			pageMakeover.apply(cfg);
			if (cfg.pageCleanupEnabled) startCleanupObserving();
			else stopCleanupObserving();
			if (
				rulesChanged ||
				matchingChanged(prev, cfg) ||
				prev.mode !== cfg.mode ||
				prev.showFilterReason !== cfg.showFilterReason ||
				prev.language !== cfg.language
			) {
				refresh({ rebuild: true });
			} else {
				applyStyleVars();
			}
			if (prev.showBadgeCount !== cfg.showBadgeCount) scheduleBadge();
		});
		if (prev.showActualReplyCount !== cfg.showActualReplyCount) {
			if (!cfg.showActualReplyCount) replyCounts.clearRendered();
			else if (isHomeTimeline()) replyCounts.updateTimeline(true);
			else replyCounts.updateDetail(true);
		}

		if (!prev.debugLogging && cfg.debugLogging) {
			debugLog("Debug logging enabled", {
				url: location.href,
				filtering: active,
				matcherCount: matchers.count,
			});
			// Re-run a full scan so every already-rendered reply gets re-evaluated
			// and logged, instead of being skipped by the sig cache.
			generation++;
			fullScan();
		}
	});
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local" || !changes[RULE_DATA_KEY]) return;
		updateAccountSources(loadRuleData(changes[RULE_DATA_KEY].newValue));
		if (cfg.enabled && active) refresh({ clearReplyCountCache: true });
	});
}

// ==================== Startup ====================

async function init(): Promise<void> {
	await loadStoredConfig();
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
	debugLog("Initialized", {
		url: location.href,
		filtering: active,
		enabled: cfg.enabled,
		matcherCount: matchers.count,
		userKeywordCount: ruleView.userKeywords.length,
	});
	if (cfg.enabled && active) start();
	else applyStyleVars();

	document.addEventListener("visibilitychange", onVisibility);
}

function onVisibility(): void {
	if (!document.hidden) fullScan();
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
