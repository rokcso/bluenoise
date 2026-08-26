import "../src/content/content.css";
import { setLanguage, t } from "@/lib/i18n";
import { readFiberUserId } from "@/src/content/fiber";
import birdSvg from "@/src/content/logo-twitter.svg?raw";
import type { AppConfig, Matchers } from "@/src/contracts/config";
import { CONFIG_KEY } from "@/src/contracts/config";
import {
	ACCOUNT_LIST_KEY,
	accountIdentityToStored,
	addAccountToList,
	type AccountListIndex,
	type AccountListSnapshot,
	buildAccountListIndex,
	matchAccountIndex,
} from "@/src/domain/account-list";
import { loadConfig } from "@/src/domain/defaults";
import { buildMatchers, matchAny, matchDetail } from "@/src/domain/matcher";

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
let matchers: Matchers = {
	plain: [],
	normalization: { caseSensitive: false, ignoreSpaces: true },
	custom: [],
	count: 0,
};
let accountIndex: AccountListIndex | undefined;
let accountListVersion = 0;

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
	matchers = buildMatchers(cfg);
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
			cfg.accountWhitelist.length > 0 ||
			cfg.accountBlacklist.length > 0);

	if (
		!mainTweet &&
		(matchers.count > 0 ||
			accountListsActive ||
			cfg.filterAds ||
			cfg.filterParodyAccounts ||
			cfg.filterFanAccounts ||
			cfg.filterAutomatedAccounts)
	) {
		if (cfg.filterAds && isPromotedPost(article)) hit = "__ad__";
		if (cfg.filterParodyAccounts && isParodyAccount(article))
			hit = "__parody__";
		if (cfg.filterFanAccounts && isFanAccount(article)) hit = "__fan__";
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
					cfg.accountWhitelist,
					cfg.accountBlacklist,
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
	}
	if (pending.size) schedule();
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

// ==================== Tweet ⋯ menu injection ====================

/**
 * Inject "Add author to BlueNoise whitelist / blacklist" items into X's tweet
 * "⋯" dropdown menu. The menu is a React portal rendered outside the tweet, so
 * we associate an open menu with the tweet that opened it via a one-shot token:
 * a capture-phase click on the menu-opening button (aria-haspopup="menu")
 * stashes its closest tweet; a dedicated observer then injects when the menu
 * enters the DOM and immediately clears the token.
 */

/** X's dropdown menu container. role="menu" is broader (covers non-tweet
 *  menus), but the one-shot token + isConnected guard keep us safe. */
const MENU_SEL = '[data-testid="Dropdown"]';
/** The menu-opening button (⋯ / caret). Stable and not localized. */
const MENU_OPENER_SEL = '[aria-haspopup="menu"]';
/** Marker class on our injected items; also used for dedupe. */
const MENU_ITEM_CLASS = "xsf-menu-item";

let menuSourceArticle: Element | null = null;
let menuObserver: MutationObserver | null = null;

function buildMenuAction(
	article: Element,
	list: "whitelist" | "blacklist",
): HTMLElement {
	const label =
		list === "whitelist"
			? t("contextMenu_addToWhitelist")
			: t("contextMenu_addToBlacklist");
	const el = document.createElement("div");
	el.className = MENU_ITEM_CLASS;
	el.setAttribute("role", "menuitem");
	el.setAttribute("tabindex", "-1");
	const span = document.createElement("span");
	span.textContent = label;
	el.append(span);
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
	if (menu.querySelector(`.${MENU_ITEM_CLASS}`)) return;
	// Append after X's native items; never add data-testid (see sanitizeRevealClone).
	const whitelist = buildMenuAction(article, "whitelist");
	const blacklist = buildMenuAction(article, "blacklist");
	menu.append(whitelist, blacklist);
	hideTweetMenuToken();
}

function hideTweetMenuToken(): void {
	menuSourceArticle = null;
}

/** Add the tweet's author to a local account list via storage, deduped. */
async function addMenuAccount(
	article: Element,
	list: "whitelist" | "blacklist",
): Promise<void> {
	const identity = readAuthorIdentity(article, true);
	const stored = accountIdentityToStored(identity);
	if (!stored) return;
	const { config } = await chrome.storage.local.get(CONFIG_KEY);
	const latest = loadConfig(config);
	const field = list === "whitelist" ? "accountWhitelist" : "accountBlacklist";
	const next = addAccountToList(latest[field], stored);
	if (next === null) return; // already present or invalid
	await chrome.storage.local.set({ config: { ...latest, [field]: next } });
	// Writing config fires storage.onChanged → watchConfig → refresh(),
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
	if (article) menuSourceArticle = article;
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
					: node.querySelector(MENU_SEL);
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
	document.removeEventListener("pointermove", onPointerMove);
	window.removeEventListener("scroll", hideReveal, { capture: true });
	window.removeEventListener("resize", hideReveal);
	window.removeEventListener("popstate", onUrlChange);
	window.removeEventListener("pageshow", onPageShow);
	document.removeEventListener("visibilitychange", onVisibility);
	hideReveal();
	pending.clear();
}

function refresh(options: { rebuild?: boolean } = {}): void {
	if (options.rebuild) refreshMatchers();
	generation++;
	// A visual clone is owned by this script rather than X's virtualized list.
	// It must never survive a SPA route transition.
	hideReveal();
	pending.clear();
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
	return new Promise((resolve) => {
		chrome.storage.local.get(CONFIG_KEY, (result) => {
			cfg = loadConfig(result.config);
			setLanguage(cfg.language);
			resolve();
		});
	});
}

const MATCH_KEYS = [
	"enabled",
	"filterAds",
	"filterParodyAccounts",
	"filterFanAccounts",
	"filterAutomatedAccounts",
	"matchNames",
	"ignoreSpaces",
	"caseSensitive",
] as const;
const MATCH_LIST_KEYS = ["userKeywords", "subscriptions", "whitelist"] as const;

function listSignature(value: unknown): string {
	return Array.isArray(value) ? value.join("\n") : `factory${SEP}`;
}

function matchingChanged(prev: AppConfig, next: AppConfig): boolean {
	for (const key of MATCH_KEYS) {
		if (prev[key] !== next[key]) return true;
	}
	for (const key of MATCH_LIST_KEYS) {
		if (listSignature(prev[key]) !== listSignature(next[key])) return true;
	}
	if (prev.accountListEnabled !== next.accountListEnabled) return true;
	if (prev.externalAccountListsEnabled !== next.externalAccountListsEnabled)
		return true;
	for (const key of ["accountWhitelist", "accountBlacklist"] as const) {
		if (listSignature(prev[key]) !== listSignature(next[key])) return true;
	}
	return false;
}

function watchConfig(): void {
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local" || !changes.config) return;
		const prev = cfg;
		cfg = loadConfig(changes.config.newValue);
		setLanguage(cfg.language);
		applyLogo();

		if (matchingChanged(prev, cfg)) {
			refresh({ rebuild: true });
		} else {
			applyStyleVars();
		}
		if (prev.showBadgeCount !== cfg.showBadgeCount) scheduleBadge();

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
		if (area !== "local" || !changes[ACCOUNT_LIST_KEY]) return;
		const next = changes[ACCOUNT_LIST_KEY].newValue as
			| AccountListSnapshot
			| undefined;
		accountIndex = next ? buildAccountListIndex(next) : undefined;
		accountListVersion = next?.version ?? 0;
		if (cfg.enabled && active) refresh();
	});
}

// ==================== Startup ====================

async function init(): Promise<void> {
	await Promise.all([loadStoredConfig(), loadAccountList(), waitForBody()]);
	refreshMatchers();
	watchConfig();
	hookHistory();
	hookReveal();
	// Tweet-menu injection works on every X page, independent of filtering state.
	hookTweetMenu();
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
		userKeywordCount: cfg.userKeywords.length,
	});
	if (cfg.enabled && active) start();
	else applyStyleVars();

	document.addEventListener("visibilitychange", onVisibility);
}

function onVisibility(): void {
	if (!document.hidden) fullScan();
}

async function loadAccountList(): Promise<void> {
	const result = await chrome.storage.local.get(ACCOUNT_LIST_KEY);
	const snapshot = result[ACCOUNT_LIST_KEY] as AccountListSnapshot | undefined;
	accountIndex = snapshot ? buildAccountListIndex(snapshot) : undefined;
	accountListVersion = snapshot?.version ?? 0;
}
