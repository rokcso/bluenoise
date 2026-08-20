import "../src/content/content.css";
import { setLanguage } from "@/lib/i18n";
import type { AppConfig, Matchers } from "@/src/contracts/config";
import { CONFIG_KEY } from "@/src/contracts/config";
import {
	ACCOUNT_LIST_KEY,
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
	async main() {
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

/** Whether the current URL is a status (tweet detail) page. Only those are filtered. */
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

function hookReveal(): void {
	document.addEventListener("pointermove", (event) => {
		const target = event.target;
		const row =
			target instanceof Element ? target.closest(`.${HIT_CLASS}`) : null;
		if (row) showReveal(row, event.clientX, event.clientY);
		else hideReveal();
	});
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

/** The main tweet (the one you opened) is never filtered — only replies are. */
function isMainTweet(article: Element): boolean {
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

function syncMarkedRowsInteractivity(): void {
	for (const row of document.querySelectorAll(`.${HIT_CLASS}`)) {
		setRowInert(row, cfg.mode === "hide");
	}
}

/** Effect switch: only touch one attribute and one CSS variable on <html>. */
function applyStyleVars(): void {
	const root = document.documentElement;
	if (!cfg.enabled || !active) {
		root.removeAttribute(MODE_ATTR);
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

	if (
		!mainTweet &&
		(matchers.count > 0 ||
			(cfg.accountListEnabled &&
				(cfg.externalAccountListsEnabled ||
					cfg.accountWhitelist.length > 0 ||
					cfg.accountBlacklist.length > 0)))
	) {
		const identity = readAuthorIdentity(article);
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

	console.group?.(`[BlueNoise] Filtered ${logs.length} reply(s)`);
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

function readAuthorIdentity(article: Element): {
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
	const id =
		article.getAttribute("data-user-id") ??
		name?.getAttribute("data-user-id") ??
		name
			?.querySelector<HTMLElement>("[data-user-id]")
			?.getAttribute("data-user-id") ??
		undefined;
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
			console.error("[BlueNoise] Failed to process a reply:", error);
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
		chrome.runtime.sendMessage({ type: "XSF_COUNT", count }).catch(() => {});
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
		if (message?.type === "XSF_GET_COUNT") {
			sendResponse({ count: currentFilteredCount() });
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
		rescanTimers.push(window.setTimeout(fullScan, delay));
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

function refresh(options: { rebuild?: boolean } = {}): void {
	if (options.rebuild) refreshMatchers();
	generation++;
	// A visual clone is owned by this script rather than X's virtualized list.
	// It must never survive a SPA route transition.
	hideReveal();
	pending.clear();
	active = isStatusPage();

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

		if (matchingChanged(prev, cfg)) {
			refresh({ rebuild: true });
		} else {
			applyStyleVars();
		}
		if (prev.showBadgeCount !== cfg.showBadgeCount) scheduleBadge();

		if (!prev.debugLogging && cfg.debugLogging) {
			debugLog("Debug logging enabled", {
				url: location.href,
				isStatusPage: active,
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
	// Keep the observer alive off status pages as well. It is the reliable
	// fallback that notices a later X SPA transition back to a status page.
	startObserving();

	active = isStatusPage();
	debugLog("Initialized", {
		url: location.href,
		isStatusPage: active,
		enabled: cfg.enabled,
		matcherCount: matchers.count,
		userKeywordCount: cfg.userKeywords.length,
	});
	if (cfg.enabled && active) start();
	else applyStyleVars();

	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) fullScan();
	});
}

async function loadAccountList(): Promise<void> {
	const result = await chrome.storage.local.get(ACCOUNT_LIST_KEY);
	const snapshot = result[ACCOUNT_LIST_KEY] as AccountListSnapshot | undefined;
	accountIndex = snapshot ? buildAccountListIndex(snapshot) : undefined;
	accountListVersion = snapshot?.version ?? 0;
}
