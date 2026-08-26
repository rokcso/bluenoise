import "../src/content/content.css";
import { setLanguage } from "@/lib/i18n";
import { readFiberUserId } from "@/src/content/fiber";
import birdSvg from "@/src/content/logo-twitter.svg?raw";
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
	matchAccountIndex,
	mergeAccountListSnapshots,
} from "@/src/domain/account-list";
import {
	defaultConfig,
	defaultRuleData,
	loadConfig,
} from "@/src/domain/defaults";
import { buildMatchers, matchAny, matchDetail } from "@/src/domain/matcher";
import { createRuleView, loadRuleData } from "@/src/domain/rules";

const ARTICLE_SEL = 'article[data-testid="tweet"], article[role="article"]';
const CELL_SEL = 'div[data-testid="cellInnerDiv"]';
const TEXT_SEL = '[data-testid="tweetText"], [data-testid="postText"]';
const NAME_SEL = '[data-testid="User-Name"], [data-testid="userName"]';

const HIT_CLASS = "xsf-filtered";
const SEP = "\u001f";
const HIT_ATTR = "data-xsf-keyword";
const INERT_ATTR = "data-xsf-inert";
const MODE_ATTR = "data-xsf-mode";
const INVISIBLE_ATTR = "data-xsf-invisible";
/** When present, hides X's "Subscribe to Premium" upsell card (CSS-driven). */
const PREMIUM_ATTR = "data-xsf-hide-premium";
/** When present, hides X's site footer (CSS-driven). */
const FOOTER_ATTR = "data-xsf-hide-footer";
/** When present, hides X's current trends panel (CSS-driven). */
const TRENDS_ATTR = "data-xsf-hide-trends";
/** When present, hides X's "Who to follow" panel (CSS-driven). */
const FOLLOW_ATTR = "data-xsf-hide-follow";
const TITLE_COUNT_ATTR = "data-xsf-hide-title-count";
const BADGES_ATTR = "data-xsf-hide-notification-badges";
const NEW_POSTS_ATTR = "data-xsf-hide-new-posts";
const GROK_ATTR = "data-xsf-hide-grok";
const MESSAGE_ATTR = "data-xsf-hide-message";
const CUSTOM_HIDDEN_ATTR = "data-xsf-custom-hidden";
const SIDEBAR_ATTR = "data-xsf-collapse-sidebar";
const COMPOSE_ICON_MARK = "data-xsf-compose-icon";
const DISCOVER_MORE_RE = /^(?:\u53d1\u73b0\u66f4\u591a|discover more)$/i;
const COUNT_PREFIX_RE = /^(\s*)\d[\d,.]*\s*/;

/** X's header logo link — its aria-label is the stable "X" brand name. */
const LOGO_SEL = 'a[aria-label="X"] svg';
/** Marker attribute set on an <svg> while it shows the Twitter blue bird. */
const BIRD_MARK = "data-xsf-bird";
let birdData: { viewBox: string; fill: string; path: string } | undefined;
const TITLE_COUNT_RE = /^\(\d+\+?\)\s*/;
let titleBeforeCount = "";
const originalFavicons = new Map<HTMLLinkElement, string>();
const CLEAN_FAVICON = "https://x.com/favicon.ico";

function getBirdData(): { viewBox: string; fill: string; path: string } {
	if (birdData) return birdData;
	const doc = new DOMParser().parseFromString(birdSvg, "image/svg+xml");
	const source = doc.querySelector("svg");
	const path = source?.querySelector("path");
	if (!source || !path) throw new Error("Invalid Twitter logo SVG");
	const next = {
		viewBox: source.getAttribute("viewBox") ?? "0 0 248 204",
		fill: path.getAttribute("fill") ?? "#1d9bf0",
		path: path.getAttribute("d") ?? "",
	};
	birdData = next;
	return next;
}
const OPACITY_VAR = "--xsf-opacity";
const DIM_OPACITY = 0.15;
const REVEAL_RADIUS = 40;

/** X renders async after SPA navigation; rescan at these delays to catch stragglers. */
const RESCAN_DELAYS = [0, 250, 800, 1800, 3500];
/** Beyond this many mutation records per callback, fall back to a full scan. */
const MUTATION_BURST = 800;

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
let accountIndex: AccountListIndex | undefined;
let accountListVersion = 0;

interface DisplayedReplyCountState {
	button: HTMLButtonElement;
	text: HTMLElement;
	originalText: string;
	injectedText: string;
	originalAria: string | null;
	injectedAria: string | null;
	group: HTMLElement | null;
	originalGroupAria: string | null;
	injectedGroupAria: string | null;
}

interface ComposeIconState {
	originalChildren: DocumentFragment;
}

/** Reply-count DOM touched by this script, so it can always be restored. */
const displayedReplyCounts = new Set<DisplayedReplyCountState>();
/** Counts learned from a detail page during this SPA session, keyed by tweet id. */
const replyCountCache = new Map<string, number>();
/**
 * Every loaded reply in a detail view, keyed by root tweet then reply tweet id.
 * X virtualizes its list, so a reply can leave the DOM while it must remain in
 * the displayed count for the rest of this browsing session.
 */
const replyLedgers = new Map<string, Map<string, boolean>>();
const MAX_CACHED_REPLY_THREADS = 50;
const composeOriginalChildren = new Map<HTMLElement, ComposeIconState>();
/** Inline styles owned by the compact-sidebar feature, restored on disable. */
const sidebarOriginalStyles = new Map<HTMLElement, string>();
/** Original classes for the structural nodes switched to X's native compact form. */
const sidebarOriginalClasses = new Map<HTMLElement, string>();

/** Whether the current page is filterable: a status (tweet detail) page or the home timeline. */
let active = false;
/** Bumped on config change to invalidate stale results cached in the WeakMap. */
let generation = 0;

const state = new WeakMap<
	Element,
	{ sig: string; hit: string | null; log: FilteredLog | null }
>();
const pending = new Set<Element>();

/** A single filtered reply, recorded only when debug logging is enabled. */
interface FilteredLog {
	handle?: string;
	id?: string;
	/** Why it was filtered: a keyword rule or the account blacklist. */
	category: "keyword" | "account";
	/** Which text matched, body or display name (keyword hits only). */
	field?: "body" | "name";
	/** The raw rule (keyword or /regex/) that matched. */
	rule?: string;
	/** Which list the rule came from: a subscription name or "user". */
	source?: string;
	kind?: "plain" | "regex";
	/** Short excerpt of the offending text around the match. */
	snippet?: string;
}
let flushScheduled = false;
let rafId = 0;
let flushTimer = 0;
let observer: MutationObserver | null = null;
let lastUrl = typeof location !== "undefined" ? location.href : "";
const rescanTimers: number[] = [];
let badgeTimer = 0;
let lastBadge = -1;
let reveal: { el: HTMLElement; row: Element } | null = null;
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

function hideReveal(): void {
	reveal?.el.remove();
	reveal = null;
}

/**
 * Strip X's structural testid markers from the reveal overlay. X's virtualized
 * list reconciliation decides which tweets to aria-hide partly by scanning for
 * its own `data-testid` markers. If the overlay kept them, X would see an
 * "extra copy" of the tweet, lose track of the active row, and apply
 * `aria-hidden` to a focused real link — producing the DevTools warning
 * "Blocked aria-hidden on an element because its descendant retained focus."
 * `data-testid` has no layout effect, so visual fidelity is preserved.
 */
function sanitizeRevealClone(el: HTMLElement): void {
	for (const node of el.querySelectorAll<HTMLElement>("[data-testid]")) {
		node.removeAttribute("data-testid");
	}
	el.removeAttribute("data-testid");
}

function showReveal(row: Element, x: number, y: number): void {
	if (!cfg.enabled || !active || cfg.mode !== "dim" || !cfg.revealOnHover) {
		hideReveal();
		return;
	}

	if (!reveal || reveal.row !== row) {
		const rect = row.getBoundingClientRect();
		if (!rect.width || !rect.height) {
			hideReveal();
			return;
		}
		hideReveal();
		const el = row.cloneNode(true) as HTMLElement;
		el.classList.remove(HIT_CLASS);
		el.classList.add("xsf-reveal");
		el.removeAttribute(HIT_ATTR);
		sanitizeRevealClone(el);
		// The clone contains X links; inert keeps this purely visual overlay out of
		// both sequential focus navigation and the accessibility tree.
		el.inert = true;
		// Do not add a cloned X component into its React-managed list. X reuses
		// those rows during SPA navigation and can otherwise reconcile focus and
		// aria-hidden against our extra copy.
		document.body.append(el);
		el.style.left = `${rect.left}px`;
		el.style.top = `${rect.top}px`;
		el.style.width = `${rect.width}px`;
		el.style.height = `${rect.height}px`;
		el.style.margin = "0";
		el.style.setProperty("opacity", "1", "important");
		el.style.setProperty("filter", "none", "important");

		// X can transform an ancestor, changing the containing block for fixed
		// children. Correct that offset once when the clone is created; repeatedly
		// correcting it during pointer movement causes the reveal to drift.
		const initialRect = el.getBoundingClientRect();
		el.style.left = `${rect.left + (rect.left - initialRect.left)}px`;
		el.style.top = `${rect.top + (rect.top - initialRect.top)}px`;
		reveal = { el, row };
	}

	const cloneRect = reveal.el.getBoundingClientRect();
	reveal.el.style.setProperty("--xsf-reveal-x", `${x - cloneRect.left}px`);
	reveal.el.style.setProperty("--xsf-reveal-y", `${y - cloneRect.top}px`);
	reveal.el.style.setProperty("--xsf-reveal-radius", `${REVEAL_RADIUS}px`);
}

function onPointerMove(event: PointerEvent): void {
	const target = event.target;
	const row =
		target instanceof Element ? target.closest(`.${HIT_CLASS}`) : null;
	if (row) showReveal(row, event.clientX, event.clientY);
	else hideReveal();
}

function hookReveal(): void {
	document.addEventListener("pointermove", onPointerMove);
	window.addEventListener("scroll", hideReveal, {
		capture: true,
		passive: true,
	});
	window.addEventListener("resize", hideReveal, { passive: true });
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

/** Replace only X's leading metric in an accessible action label. */
function replaceLabelCount(label: string | null, count: string): string | null {
	return label?.replace(COUNT_PREFIX_RE, `$1${count} `) ?? null;
}

function clearDisplayedReplyCounts(): void {
	for (const state of displayedReplyCounts) {
		if (state.text.isConnected && state.text.textContent === state.injectedText)
			state.text.textContent = state.originalText;
		if (
			state.button.isConnected &&
			state.button.getAttribute("aria-label") === state.injectedAria
		) {
			if (state.originalAria === null)
				state.button.removeAttribute("aria-label");
			else state.button.setAttribute("aria-label", state.originalAria);
		}
		if (
			state.group?.isConnected &&
			state.group.getAttribute("aria-label") === state.injectedGroupAria
		) {
			if (state.originalGroupAria === null)
				state.group.removeAttribute("aria-label");
			else state.group.setAttribute("aria-label", state.originalGroupAria);
		}
	}
	displayedReplyCounts.clear();
}

function isNestedArticle(article: Element): boolean {
	return Boolean(article.parentElement?.closest(ARTICLE_SEL));
}

function isAfter(first: Node, second: Node): boolean {
	return Boolean(
		first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
	);
}

function replyLedgerFor(rootId: string): Map<string, boolean> {
	const existing = replyLedgers.get(rootId);
	if (existing) {
		// Move this thread to the end so the map acts as a small LRU cache.
		replyLedgers.delete(rootId);
		replyLedgers.set(rootId, existing);
		return existing;
	}
	const ledger = new Map<string, boolean>();
	replyLedgers.set(rootId, ledger);
	while (replyLedgers.size > MAX_CACHED_REPLY_THREADS) {
		const oldest = replyLedgers.keys().next().value;
		if (!oldest) break;
		replyLedgers.delete(oldest);
		replyCountCache.delete(oldest);
	}
	return ledger;
}

function clearReplyCountCaches(): void {
	replyCountCache.clear();
	replyLedgers.clear();
}

/**
 * Record loaded top-level replies in the current conversation, then count the
 * retained ledger entries. X also puts promoted and "Discover more" content in
 * this region, so neither can be recorded as a reply.
 */
function recordDisplayedReplyCount(mainTweet: Element): number | null {
	const conversation = mainTweet.closest('section[role="region"]');
	if (!conversation) return null;
	const rootId = tweetIdOf(mainTweet);
	if (!rootId) return null;
	const ledger = replyLedgerFor(rootId);
	const discoverMore = [...conversation.querySelectorAll("h1, h2, h3")].find(
		(heading) => DISCOVER_MORE_RE.test(heading.textContent?.trim() ?? ""),
	);
	for (const article of conversation.querySelectorAll(ARTICLE_SEL)) {
		if (
			article === mainTweet ||
			isNestedArticle(article) ||
			!isAfter(mainTweet, article) ||
			(discoverMore && isAfter(discoverMore, article)) ||
			isPromotedPost(article)
		)
			continue;
		const replyId = tweetIdOf(article);
		if (replyId)
			ledger.set(replyId, !rowOf(article).classList.contains(HIT_CLASS));
	}
	return [...ledger.values()].filter(Boolean).length;
}

function tweetIdOf(article: Element): string | null {
	for (const link of article.querySelectorAll<HTMLAnchorElement>(
		'a[href*="/status/"]',
	)) {
		// The timestamp link belongs to this tweet, unlike a link in quoted media.
		if (!link.querySelector("time")) continue;
		const id = link.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1];
		if (id) return id;
	}
	return null;
}

function renderDisplayedReplyCount(article: Element, count: number): void {
	const button = article.querySelector<HTMLButtonElement>(
		'button[data-testid="reply"]',
	);
	const container = button?.querySelector<HTMLElement>(
		'[data-testid="app-text-transition-container"]',
	);
	const text = container?.firstElementChild;
	if (!button || !(text instanceof HTMLElement)) return;

	const formatted = count.toLocaleString();
	let state = [...displayedReplyCounts].find((item) => item.button === button);
	if (!state) {
		const group = button.closest<HTMLElement>('[role="group"]');
		state = {
			button,
			text,
			originalText: text.textContent ?? "",
			injectedText: "",
			originalAria: button.getAttribute("aria-label"),
			injectedAria: null,
			group,
			originalGroupAria: group?.getAttribute("aria-label") ?? null,
			injectedGroupAria: null,
		};
		displayedReplyCounts.add(state);
	} else {
		// A React update can replace X's server count in place; retain that latest
		// value so disabling the extension restores the correct native metric.
		if (text.textContent !== state.injectedText)
			state.originalText = text.textContent ?? "";
		const aria = button.getAttribute("aria-label");
		if (aria !== state.injectedAria) state.originalAria = aria;
		const groupAria = state.group?.getAttribute("aria-label") ?? null;
		if (groupAria !== state.injectedGroupAria)
			state.originalGroupAria = groupAria;
	}

	const aria = replaceLabelCount(state.originalAria, formatted);
	const groupAria = replaceLabelCount(state.originalGroupAria, formatted);
	if (text.textContent !== formatted) text.textContent = formatted;
	if (aria !== null && button.getAttribute("aria-label") !== aria)
		button.setAttribute("aria-label", aria);
	if (
		state.group &&
		groupAria !== null &&
		state.group.getAttribute("aria-label") !== groupAria
	)
		state.group.setAttribute("aria-label", groupAria);
	state.injectedText = formatted;
	state.injectedAria = aria;
	state.injectedGroupAria = groupAria;
}

function updateDisplayedReplyCount(): void {
	if (!active || !cfg.enabled || !cfg.showActualReplyCount || !isStatusPage()) {
		clearDisplayedReplyCounts();
		return;
	}
	const mainTweet = [...document.querySelectorAll(ARTICLE_SEL)].find(
		isMainTweet,
	);
	if (!mainTweet) return;
	const count = recordDisplayedReplyCount(mainTweet);
	if (count === null) return;
	const id = tweetIdOf(mainTweet);
	if (id) replyCountCache.set(id, count);
	renderDisplayedReplyCount(mainTweet, count);
}

function updateTimelineReplyCounts(): void {
	if (!active || !cfg.enabled || !cfg.showActualReplyCount || !isHomeTimeline())
		return;
	for (const article of document.querySelectorAll(ARTICLE_SEL)) {
		const id = tweetIdOf(article);
		const count = id ? replyCountCache.get(id) : undefined;
		if (count !== undefined) renderDisplayedReplyCount(article, count);
	}
}

function applyMark(article: Element, hit: string | null): void {
	const row = rowOf(article);
	if (hit) {
		setRowInert(row, cfg.mode === "hide");
		row.classList.add(HIT_CLASS);
		row.setAttribute(HIT_ATTR, hit);
	} else if (row.classList.contains(HIT_CLASS)) {
		row.classList.remove(HIT_CLASS);
		row.removeAttribute(HIT_ATTR);
		setRowInert(row, false);
	}
}

/** X wraps promoted posts in an impression-tracking container. */
function isPromotedPost(article: Element): boolean {
	const cell = article.closest(CELL_SEL);
	return Boolean(cell?.querySelector('[data-testid="placementTracking"]'));
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

function applyPageCustomizations(): void {
	const enabled = cfg.enabled;
	for (const el of document.querySelectorAll(`[${CUSTOM_HIDDEN_ATTR}]`))
		el.removeAttribute(CUSTOM_HIDDEN_ATTR);
	// Title/favicon state must also be restored when the master switch is off.
	applyTitleAndFavicon();
	if (!enabled) return;

	const hideAncestors = (element: Element, levels: number): void => {
		let current: Element | null = element;
		for (let i = 0; i <= levels && current; i++) {
			if (current instanceof HTMLElement)
				current.setAttribute(CUSTOM_HIDDEN_ATTR, "");
			current = current.parentElement;
		}
	};
	if (cfg.hideFollowSuggestions) {
		for (const aside of document.querySelectorAll<HTMLElement>(
			'aside[role="complementary"]:has(> div > h2[role="heading"]):has(> ul[role="list"] > li[data-testid="UserCell"])',
		))
			hideAncestors(aside, 2);
	}
	if (cfg.hideTimelineFollowSuggestions) {
		const primary = document.querySelector('[data-testid="primaryColumn"]');
		const hasTimelineHeading = [
			...(primary?.querySelectorAll("h2") ?? []),
		].some((h) => /推荐关注|who to follow/i.test(h.textContent ?? ""));
		if (hasTimelineHeading) {
			for (const cell of primary?.querySelectorAll<HTMLElement>(
				`[data-testid="${"cellInnerDiv"}"]:has([data-testid="UserCell"]), [data-testid="cellInnerDiv"]:has(a[href^="/i/connect_people"])`,
			) ?? [])
				cell.setAttribute(CUSTOM_HIDDEN_ATTR, "");
		}
	}
	if (cfg.hideDiscoverMore && isStatusPage()) {
		for (const heading of document.querySelectorAll<HTMLElement>(
			'h2[role="heading"][aria-level="2"]',
		)) {
			if (!/发现更多|discover more/i.test(heading.textContent ?? "")) continue;
			const cell = heading.closest<HTMLElement>('[data-testid="cellInnerDiv"]');
			if (!cell) continue;
			cell.setAttribute(CUSTOM_HIDDEN_ATTR, "");
			// Discover more is the final recommendation block on a status page;
			// its virtualized content is rendered as following sibling cells.
			for (
				let next = cell.nextElementSibling;
				next?.matches('[data-testid="cellInnerDiv"]');
				next = next.nextElementSibling
			)
				next.setAttribute(CUSTOM_HIDDEN_ATTR, "");
		}
	}
	if (cfg.hideTrends) {
		for (const section of document.querySelectorAll<HTMLElement>(
			'section[role="region"]:has(> h1[role="heading"]):has([data-testid="trend"])',
		))
			hideAncestors(section, 1);
	}
	if (cfg.hideFooter) {
		for (const nav of document.querySelectorAll<HTMLElement>(
			'nav[role="navigation"]:has(a[href$="/tos"])',
		))
			hideAncestors(nav, 1);
	}
	if (cfg.hideNotificationBadges) {
		for (const badge of document.querySelectorAll<HTMLElement>(
			'[data-testid="AppTabBar_Home_Link"] svg + div[aria-label], [data-testid="AppTabBar_Notifications_Link"] svg + div[aria-label]',
		))
			badge.setAttribute(CUSTOM_HIDDEN_ATTR, "");
	}
	if (cfg.hideNewPostsPrompt) {
		for (const label of document.querySelectorAll<HTMLElement>(
			'[data-testid="primaryColumn"] [data-testid="pillLabel"]',
		)) {
			const pill = label.parentElement;
			if (pill?.querySelector(':scope > [data-testid="userAvatars"]'))
				hideAncestors(pill, 0);
		}
	}
	if (cfg.hideGrokButton) {
		for (const drawer of document.querySelectorAll<HTMLElement>(
			'[data-testid="GrokDrawer"]',
		))
			hideAncestors(drawer, 2);
	}
	if (cfg.hideMessageButton) {
		for (const drawer of document.querySelectorAll<HTMLElement>(
			'[data-testid="chat-drawer-root"]',
		))
			hideAncestors(drawer, 2);
	}
}

function applyTitleAndFavicon(): void {
	const hide = cfg.enabled && cfg.hideTitleCount;
	if (hide && document.title && TITLE_COUNT_RE.test(document.title)) {
		titleBeforeCount ||= document.title;
		document.title = document.title.replace(TITLE_COUNT_RE, "");
	} else if (!hide && titleBeforeCount) {
		if (!TITLE_COUNT_RE.test(document.title)) document.title = titleBeforeCount;
		titleBeforeCount = "";
	}
	const links = document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]');
	if (hide) {
		for (const link of links) {
			if (!originalFavicons.has(link)) originalFavicons.set(link, link.href);
			link.href = CLEAN_FAVICON;
		}
	} else {
		for (const [link, href] of originalFavicons)
			if (link.isConnected) link.href = href;
		originalFavicons.clear();
	}
}

function createComposeIcon(): SVGSVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("class", "xsf-compose-icon");
	svg.setAttribute(COMPOSE_ICON_MARK, "");
	const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
	for (const [pathData, fillRule] of [
		[
			"M10.938 4.5H9.9c-1.136 0-1.929 0-2.546.05-.605.05-.953.143-1.216.277-.564.288-1.023.747-1.31 1.31-.135.264-.228.612-.277 1.218C4.5 7.97 4.5 8.765 4.5 9.9v4.2c0 1.136 0 1.929.05 2.546.05.605.143.953.277 1.216.288.565.747 1.023 1.31 1.31.264.135.612.228 1.217.277.617.05 1.41.051 2.546.051h4.2c1.136 0 1.929 0 2.545-.05.606-.05.954-.143 1.217-.277.565-.288 1.023-.746 1.31-1.31.135-.264.228-.612.277-1.217.05-.617.051-1.41.051-2.546v-1.037h2V14.1c0 1.103.001 1.992-.058 2.709-.06.728-.185 1.368-.487 1.96-.48.941-1.245 1.707-2.185 2.186-.593.302-1.233.428-1.961.488-.718.058-1.606.057-2.71.057H9.9c-1.103 0-1.991.001-2.709-.058-.728-.06-1.368-.185-1.96-.487-.941-.48-1.707-1.245-2.186-2.185-.302-.593-.428-1.233-.487-1.961-.059-.718-.058-1.606-.058-2.71V9.9c0-1.103-.001-1.991.058-2.709.06-.728.185-1.368.487-1.96.48-.941 1.245-1.707 2.185-2.186.593-.302 1.233-.428 1.961-.487.718-.059 1.606-.058 2.71-.058h1.037v2z",
			undefined,
		],
		[
			"M16.293 3.293c1.219-1.219 3.195-1.219 4.414 0 1.219 1.219 1.219 3.195 0 4.414l-5.491 5.491c-.533.533-.89.896-1.31 1.179-.356.24-.742.433-1.148.574-.478.167-.983.234-1.729.341l-2.708.387.387-2.708c.107-.746.174-1.25.34-1.729.142-.405.335-.792.575-1.148.283-.42.646-.777 1.179-1.31l5.491-5.491zm3 1.414c-.438-.438-1.148-.438-1.586 0l-5.491 5.491c-.587.587-.784.79-.934 1.013-.144.214-.26.445-.345.688-.088.254-.131.533-.248 1.354l-.01.067.068-.008c.82-.118 1.1-.161 1.354-.25.243-.084.474-.2.688-.344.223-.15.426-.347 1.013-.934l5.491-5.491c.438-.438.438-1.148 0-1.586z",
			"evenodd",
		],
	] as const) {
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", pathData);
		if (fillRule) {
			path.setAttribute("clip-rule", fillRule);
			path.setAttribute("fill-rule", fillRule);
		}
		group.append(path);
	}
	svg.append(group);
	return svg;
}

function restoreSidebarComposeIcons(): void {
	for (const [content, state] of composeOriginalChildren) {
		if (
			content.isConnected &&
			content.querySelector(`[${COMPOSE_ICON_MARK}]`)
		) {
			content.replaceChildren();
			content.append(state.originalChildren);
		}
	}
	composeOriginalChildren.clear();
	for (const button of document.querySelectorAll<HTMLElement>(
		"[data-xsf-compact-compose]",
	))
		button.removeAttribute("data-xsf-compact-compose");
}

function setSidebarStyle(element: HTMLElement, cssText: string): void {
	if (sidebarOriginalStyles.has(element)) return;
	sidebarOriginalStyles.set(element, element.style.cssText);
	element.style.cssText += `;${cssText}`;
}

function restoreSidebarStyles(): void {
	for (const [element, cssText] of sidebarOriginalStyles)
		if (element.isConnected) element.style.cssText = cssText;
	sidebarOriginalStyles.clear();
}

function setSidebarClasses(
	element: HTMLElement,
	remove: string[],
	add: string[],
): void {
	if (!sidebarOriginalClasses.has(element))
		sidebarOriginalClasses.set(element, element.className);
	element.classList.remove(...remove);
	element.classList.add(...add);
}

function restoreSidebarClasses(): void {
	for (const [element, className] of sidebarOriginalClasses)
		if (element.isConnected) element.className = className;
	sidebarOriginalClasses.clear();
	for (const button of document.querySelectorAll<HTMLElement>(
		"[data-xsf-compact-account]",
	))
		button.removeAttribute("data-xsf-compact-account");
}

/** Remove width declarations written by earlier versions of this feature. */
function clearLegacySidebarGeometry(element: HTMLElement): void {
	for (const property of [
		"width",
		"min-width",
		"max-width",
		"margin-left",
		"margin-right",
		"box-sizing",
		"flex",
		"transition",
	]) {
		if (element.style.getPropertyPriority(property) === "important")
			element.style.removeProperty(property);
	}
}

function applyCompactComposeClasses(button: HTMLAnchorElement): void {
	button.setAttribute("data-xsf-compact-compose", "");
	setSidebarStyle(
		button,
		"width:52px !important; min-width:52px !important; height:52px !important; min-height:52px !important; border-radius:9999px !important; display:flex !important; align-items:center !important; justify-content:center !important; padding:0 !important",
	);
	const container = button.parentElement;
	if (container instanceof HTMLElement)
		setSidebarStyle(
			container,
			"width:52px !important; min-width:52px !important; max-width:52px !important; margin-left:0 !important; margin-right:0 !important; align-self:flex-start !important",
		);
}

/**
 * Switch the expanded sidebar shell to the same classes X uses when it renders
 * compact navigation itself. Elements are located solely by stable structure.
 */
function applySidebarCompactLayout(): void {
	if (!cfg.enabled || !cfg.collapseSidebar) {
		restoreSidebarStyles();
		restoreSidebarClasses();
		return;
	}
	for (const header of document.querySelectorAll<HTMLElement>(
		'header[role="banner"]:has([data-testid="AppTabBar_Home_Link"])',
	)) {
		const widthContainer = header.querySelector<HTMLElement>(":scope > div");
		const layoutContainer = header.querySelector<HTMLElement>(
			":scope > div > div > div",
		);
		const sidebarColumn =
			layoutContainer?.querySelector<HTMLElement>(":scope > div");
		if (widthContainer) clearLegacySidebarGeometry(widthContainer);
		if (layoutContainer) clearLegacySidebarGeometry(layoutContainer);
		if (sidebarColumn) clearLegacySidebarGeometry(sidebarColumn);
		if (widthContainer)
			setSidebarClasses(widthContainer, ["r-o96wvk"], ["r-1gymjhz"]);
		if (layoutContainer)
			setSidebarClasses(layoutContainer, ["r-o96wvk"], ["r-1gymjhz"]);
		if (sidebarColumn)
			setSidebarClasses(sidebarColumn, ["r-1habvwh"], ["r-1awozwy"]);
		const nav = header.querySelector<HTMLElement>('nav[role="navigation"]');
		if (nav) {
			const navContainer = nav.parentElement;
			if (navContainer instanceof HTMLElement) {
				clearLegacySidebarGeometry(navContainer);
				setSidebarClasses(navContainer, ["r-1habvwh"], ["r-1awozwy"]);
			}
			clearLegacySidebarGeometry(nav);
			setSidebarClasses(nav, ["r-1habvwh"], ["r-1awozwy"]);
			for (const control of nav.querySelectorAll<HTMLElement>(
				":scope > a, :scope > button",
			)) {
				clearLegacySidebarGeometry(control);
				setSidebarClasses(control, ["r-1habvwh"], ["r-cnw61z", "r-1awozwy"]);
			}
		}
		const accountButton = header.querySelector<HTMLElement>(
			'[data-testid="SideNav_AccountSwitcher_Button"]',
		);
		if (accountButton) {
			accountButton.setAttribute("data-xsf-compact-account", "");
			const accountContainer = accountButton.parentElement;
			if (accountContainer instanceof HTMLElement)
				setSidebarClasses(accountContainer, ["r-1habvwh"], ["r-1awozwy"]);
			setSidebarClasses(accountButton, ["r-1habvwh"], ["r-1awozwy"]);
		}
	}
}

/** The expanded sidebar has no compose SVG, so reproduce X's compact DOM. */
function applySidebarComposeIcons(): void {
	if (!cfg.enabled || !cfg.collapseSidebar) {
		restoreSidebarComposeIcons();
		return;
	}
	for (const button of document.querySelectorAll<HTMLAnchorElement>(
		'a[data-testid="SideNav_NewTweet_Button"]',
	)) {
		if (
			!button.closest(
				'header[role="banner"]:has([data-testid="AppTabBar_Home_Link"])',
			)
		)
			continue;
		const content = button.querySelector<HTMLElement>(":scope > div[dir]");
		if (!content) continue;
		const injectedIcon = content.querySelector<SVGSVGElement>(
			`:scope > svg[${COMPOSE_ICON_MARK}]`,
		);
		const nativeIcon = [...content.querySelectorAll(":scope > svg")].find(
			(svg) => svg !== injectedIcon,
		);
		// X can append its compact SVG after a partial expanded render. When that
		// happens, discard our temporary icon and preserve X's native one.
		if (nativeIcon) {
			const spacer = injectedIcon?.nextElementSibling;
			injectedIcon?.remove();
			if (spacer?.hasAttribute("data-xsf-compose-spacer")) spacer.remove();
			composeOriginalChildren.delete(content);
			continue;
		}
		if (injectedIcon) {
			applyCompactComposeClasses(button);
			continue;
		}
		const originalChildren = document.createDocumentFragment();
		while (content.firstChild) originalChildren.append(content.firstChild);
		composeOriginalChildren.set(content, {
			originalChildren,
		});
		applyCompactComposeClasses(button);
		content.append(createComposeIcon());
		const spacer = document.createElement("div");
		spacer.setAttribute("data-xsf-compose-spacer", "");
		const emptyLabel = document.createElement("span");
		spacer.append(emptyLabel);
		content.append(spacer);
	}
}

/** Effect switch: only touch one attribute and one CSS variable on <html>. */
function applyStyleVars(): void {
	const root = document.documentElement;
	// Page customizations apply on every X page, including profile pages. The
	// filtering effect below remains limited to the home timeline and status
	// pages via `active`.
	if (cfg.enabled && cfg.hidePremiumPromo) root.setAttribute(PREMIUM_ATTR, "");
	else root.removeAttribute(PREMIUM_ATTR);
	if (cfg.enabled && cfg.hideFooter) root.setAttribute(FOOTER_ATTR, "");
	else root.removeAttribute(FOOTER_ATTR);
	if (cfg.enabled && cfg.hideTrends) root.setAttribute(TRENDS_ATTR, "");
	else root.removeAttribute(TRENDS_ATTR);
	if (cfg.enabled && cfg.hideFollowSuggestions)
		root.setAttribute(FOLLOW_ATTR, "");
	else root.removeAttribute(FOLLOW_ATTR);
	if (cfg.enabled && cfg.hideTitleCount)
		root.setAttribute(TITLE_COUNT_ATTR, "");
	else root.removeAttribute(TITLE_COUNT_ATTR);
	if (cfg.enabled && cfg.hideNotificationBadges)
		root.setAttribute(BADGES_ATTR, "");
	else root.removeAttribute(BADGES_ATTR);
	if (cfg.enabled && cfg.hideNewPostsPrompt)
		root.setAttribute(NEW_POSTS_ATTR, "");
	else root.removeAttribute(NEW_POSTS_ATTR);
	if (cfg.enabled && cfg.hideGrokButton) root.setAttribute(GROK_ATTR, "");
	else root.removeAttribute(GROK_ATTR);
	if (cfg.enabled && cfg.hideMessageButton) root.setAttribute(MESSAGE_ATTR, "");
	else root.removeAttribute(MESSAGE_ATTR);
	if (cfg.enabled && cfg.collapseSidebar) root.setAttribute(SIDEBAR_ATTR, "");
	else root.removeAttribute(SIDEBAR_ATTR);
	applySidebarCompactLayout();
	applySidebarComposeIcons();

	applyPageCustomizations();
	if (!cfg.enabled || !active) {
		root.removeAttribute(INVISIBLE_ATTR);
		hideReveal();
		return;
	}
	root.setAttribute(MODE_ATTR, cfg.mode === "hide" ? "hide" : "dim");
	root.style.setProperty(OPACITY_VAR, String(DIM_OPACITY));
	root.removeAttribute(INVISIBLE_ATTR);
	syncMarkedRowsInteractivity();
	if (cfg.mode !== "dim" || !cfg.revealOnHover) hideReveal();
}

// ==================== Logo replacement ====================

/**
 * Swap X's header "X" mark for the classic Twitter blue bird (or restore it).
 * This is DOM surgery (CSS cannot rewrite an <svg> path), so the original
 * viewBox/path/fill are cached on the element before overwriting so the change
 * is fully reversible. Runs on every X page (not just filterable ones); the
 * BIRD_MARK dedupes re-application when X re-renders the logo during SPA
 * navigation or while the same <svg> is re-scanned.
 */
function applyLogo(): void {
	const replace = cfg.enabled && cfg.useBlueBird;
	const bird = replace ? getBirdData() : null;
	for (const svg of document.querySelectorAll<SVGSVGElement>(LOGO_SEL)) {
		const path = svg.querySelector("path");
		if (!path) continue;
		if (replace) {
			if (!svg.hasAttribute(BIRD_MARK)) {
				svg.setAttribute(BIRD_MARK, "");
				svg.dataset.xsfOrigViewBox = svg.getAttribute("viewBox") ?? "";
				svg.dataset.xsfOrigPath = path.getAttribute("d") ?? "";
				svg.dataset.xsfOrigFill = path.getAttribute("fill") ?? "";
			}
			// X can reconcile the same SVG in place and restore its own path.
			// Re-apply the bird whenever the current path no longer matches it.
			if (
				path.getAttribute("d") === bird?.path &&
				svg.getAttribute("viewBox") === bird?.viewBox
			)
				continue;
			svg.setAttribute("viewBox", bird?.viewBox ?? "0 0 248 204");
			path.setAttribute("d", bird?.path ?? "");
			path.setAttribute("fill", bird?.fill ?? "#1d9bf0");
		} else if (svg.hasAttribute(BIRD_MARK)) {
			svg.setAttribute("viewBox", svg.dataset.xsfOrigViewBox || "0 0 24 24");
			if (svg.dataset.xsfOrigPath)
				path.setAttribute("d", svg.dataset.xsfOrigPath);
			if (svg.dataset.xsfOrigFill) {
				path.setAttribute("fill", svg.dataset.xsfOrigFill);
			} else {
				path.removeAttribute("fill");
			}
			svg.removeAttribute(BIRD_MARK);
			delete svg.dataset.xsfOrigViewBox;
			delete svg.dataset.xsfOrigPath;
			delete svg.dataset.xsfOrigFill;
		}
	}
}

// ==================== Evaluation ====================

function evaluate(article: Element): {
	fresh: boolean;
	log: FilteredLog | null;
} {
	const text = readText(article.querySelector(TEXT_SEL));
	const name = cfg.matchNames ? readText(article.querySelector(NAME_SEL)) : "";
	const sig = [generation, accountListVersion, text, name].join(SEP);

	const cached = state.get(article);
	if (cached && cached.sig === sig) {
		return { fresh: false, log: null };
	}

	const mainTweet = isMainTweet(article);
	let hit: string | null = null;
	let log: FilteredLog | null = null;

	// Account matching needs the numeric user id (React internals); keyword
	// matching only needs the @handle from the DOM.
	const accountListsActive =
		cfg.accountListEnabled &&
		(cfg.externalAccountListsEnabled ||
			ruleView.accountWhitelist.length > 0 ||
			ruleView.accountBlacklist.length > 0);

	if (
		!mainTweet &&
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
		if (
			(cfg.filterAds && isPromotedPost(article)) ||
			(cfg.filterMediaAds && isMediaAd(article)) ||
			(cfg.filterCardAds && isCardAd(article))
		)
			hit = "__ad__";
		if (cfg.filterParodyAccounts && isParodyAccount(article))
			hit = "__parody__";
		if (cfg.filterFanAccounts && isFanAccount(article)) hit = "__fan__";
		if (cfg.filterCommentaryAccounts && isCommentaryAccount(article))
			hit = "__commentary__";
		if (cfg.filterAutomatedAccounts && isAutomatedAccount(article))
			hit = "__automated__";
		if (hit) {
			state.set(article, { sig, hit, log });
			applyMark(article, hit);
			return { fresh: true, log };
		}
		const identity = readAuthorIdentity(article, accountListsActive);
		const accountMatch = cfg.accountListEnabled
			? matchAccountIndex(
					cfg.externalAccountListsEnabled ? accountIndex : undefined,
					identity,
					ruleView.accountWhitelist,
					ruleView.accountBlacklist,
				)
			: null;
		if (accountMatch === "blacklist") {
			hit = "account:blacklist";
			log = {
				handle: identity.handle,
				id: identity.id,
				category: "account",
			};
		} else if (accountMatch !== "whitelist") {
			if (cfg.debugLogging) {
				const bodyMatch = matchDetail(matchers, text);
				const nameMatch = name ? matchDetail(matchers, name) : null;
				if (bodyMatch) {
					hit = bodyMatch.hit;
					log = {
						handle: identity.handle,
						id: identity.id,
						category: "keyword",
						field: "body",
						rule: bodyMatch.hit,
						source: bodyMatch.source ?? undefined,
						kind: bodyMatch.kind,
						snippet: bodyMatch.snippet,
					};
				} else if (nameMatch) {
					hit = nameMatch.hit;
					log = {
						handle: identity.handle,
						id: identity.id,
						category: "keyword",
						field: "name",
						rule: nameMatch.hit,
						source: nameMatch.source ?? undefined,
						kind: nameMatch.kind,
						snippet: nameMatch.snippet,
					};
				}
			} else {
				hit =
					matchAny(matchers, text) ?? (name ? matchAny(matchers, name) : null);
			}
		}
	}

	state.set(article, { sig, hit, log });
	applyMark(article, hit);
	return { fresh: true, log };
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
	const queuedCount = pending.size;
	const logs: FilteredLog[] = [];
	let evaluatedCount = 0;
	for (const article of pending) {
		if (!article.isConnected) continue;
		try {
			const result = evaluate(article);
			if (result.fresh) evaluatedCount++;
			if (result.log) logs.push(result.log);
		} catch (error) {
			console.error("[BlueNoise] Failed to process an item:", error);
		}
	}
	pending.clear();
	debugLog("Scan completed", {
		queuedArticleCount: queuedCount,
		evaluatedCount,
		filteredCount: document.querySelectorAll(`.${HIT_CLASS}`).length,
	});
	if (logs.length) emitFilteredLogs(logs);
	// Run after every queued reply has received its filtering mark, so the
	// number mirrors what remains in the conversation rather than X's total.
	if (isStatusPage()) updateDisplayedReplyCount();
	else if (isHomeTimeline()) updateTimelineReplyCounts();
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
	if ((node as Element).closest?.(".xsf-reveal")) return;
	if (node instanceof Element && node.matches?.(ARTICLE_SEL)) {
		pending.add(node);
		return;
	}
	if (!(node instanceof Element)) return;
	for (const a of node.querySelectorAll(ARTICLE_SEL)) {
		if (!a.closest(".xsf-reveal")) pending.add(a);
	}
}

function fullScan(): void {
	if (!active || !cfg.enabled) return;
	let articleCount = 0;
	for (const a of document.querySelectorAll(ARTICLE_SEL)) {
		if (a.closest(".xsf-reveal")) continue;
		articleCount++;
		pending.add(a);
	}
	debugLog("Scan queued", { articleCount });
	schedule();
}

// ==================== Incremental observation ====================

function onMutations(records: MutationRecord[]): void {
	// The header logo applies on every X page and X re-renders it on SPA
	// navigation, so re-apply before the filterable-page guard below.
	applyLogo();
	applySidebarCompactLayout();
	applySidebarComposeIcons();
	applyPageCustomizations();
	for (const node of records.flatMap((record) => [...record.addedNodes]))
		if (node.nodeType === Node.ELEMENT_NODE) applyPageCustomizations();
	// Content scripts run in an isolated world, so wrapping history.pushState is
	// not sufficient to observe X's own SPA navigation. Any route change also
	// changes the page DOM; notice it before processing stale rows.
	if (refreshForUrlChange()) return;
	if (!active || !cfg.enabled) return;
	if (records.length > MUTATION_BURST) {
		fullScan();
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
		if (article) pending.add(article);
		if (
			rec.type === "childList" &&
			targetElement?.closest('section[role="region"]')
		)
			conversationChanged = true;
	}
	if (pending.size || conversationChanged) schedule();
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
				applyLogo();
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
	clearDisplayedReplyCounts();
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
	document.removeEventListener("pointermove", onPointerMove);
	window.removeEventListener("scroll", hideReveal, { capture: true });
	window.removeEventListener("resize", hideReveal);
	window.removeEventListener("popstate", onUrlChange);
	window.removeEventListener("pageshow", onPageShow);
	document.removeEventListener("visibilitychange", onVisibility);
	restoreSidebarComposeIcons();
	restoreSidebarStyles();
	restoreSidebarClasses();
	hideReveal();
	pending.clear();
}

function refresh(
	options: { rebuild?: boolean; clearReplyCountCache?: boolean } = {},
): void {
	if (options.rebuild) refreshMatchers();
	if (options.rebuild || options.clearReplyCountCache) clearReplyCountCaches();
	generation++;
	// A visual clone is owned by this script rather than X's virtualized list.
	// It must never survive a SPA route transition.
	hideReveal();
	pending.clear();
	clearDisplayedReplyCounts();
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
	if (prev.accountListEnabled !== next.accountListEnabled) return true;
	if (prev.externalAccountListsEnabled !== next.externalAccountListsEnabled)
		return true;
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
			const accountSnapshotValue = accountSnapshot(rules);
			accountIndex = accountSnapshotValue
				? buildAccountListIndex(accountSnapshotValue)
				: undefined;
			accountListVersion = accountSnapshotValue?.version ?? 0;
			setLanguage(cfg.language);
			applyLogo();
			if (rulesChanged || matchingChanged(prev, cfg)) {
				refresh({ rebuild: true });
			} else {
				applyStyleVars();
			}
			if (prev.showBadgeCount !== cfg.showBadgeCount) scheduleBadge();
		});
		if (prev.showActualReplyCount !== cfg.showActualReplyCount) {
			if (!cfg.showActualReplyCount) clearDisplayedReplyCounts();
			else if (isHomeTimeline()) updateTimelineReplyCounts();
			else updateDisplayedReplyCount();
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
		const next = accountSnapshot(loadRuleData(changes[RULE_DATA_KEY].newValue));
		accountIndex = next ? buildAccountListIndex(next) : undefined;
		accountListVersion = next?.version ?? 0;
		if (cfg.enabled && active) refresh({ clearReplyCountCache: true });
	});
}

// ==================== Startup ====================

async function init(): Promise<void> {
	await Promise.all([loadStoredConfig(), loadAccountList(), waitForBody()]);
	refreshMatchers();
	watchConfig();
	hookHistory();
	hookReveal();
	// Keep the observer alive off status pages as well. It is the reliable
	// fallback that notices a later X SPA transition back to a status page.
	startObserving();
	applyLogo();

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
	const snapshot = accountSnapshot(loadRuleData(result[RULE_DATA_KEY]));
	accountIndex = snapshot ? buildAccountListIndex(snapshot) : undefined;
	accountListVersion = snapshot?.version ?? 0;
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
