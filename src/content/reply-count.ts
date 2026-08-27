interface DisplayState {
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

export interface ReplyCountController {
	updateDetail(enabled: boolean): void;
	updateTimeline(enabled: boolean): void;
	clearRendered(): void;
	clearCaches(): void;
}

interface ReplyCountOptions {
	articleSelector: string;
	filteredClass: string;
	isStatusPage(): boolean;
	isHomeTimeline(): boolean;
	isMainTweet(article: Element): boolean;
	isPromotedPost(article: Element): boolean;
	rowOf(article: Element): Element;
}

const DISCOVER_MORE_RE = /^(?:\u53d1\u73b0\u66f4\u591a|discover more)$/i;
const COUNT_PREFIX_RE = /^(\s*)\d[\d,.]*\s*/;
const MAX_CACHED_THREADS = 50;

function tweetIdOf(article: Element): string | null {
	for (const link of article.querySelectorAll<HTMLAnchorElement>(
		'a[href*="/status/"]',
	)) {
		if (!link.querySelector("time")) continue;
		const id = link.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1];
		if (id) return id;
	}
	return null;
}

function replaceCount(label: string | null, count: string): string | null {
	return label?.replace(COUNT_PREFIX_RE, `$1${count} `) ?? null;
}

/** Owns reply ledgers, cross-page count cache, and reversible DOM rendering. */
export function createReplyCountController(
	options: ReplyCountOptions,
): ReplyCountController {
	const displayed = new Set<DisplayState>();
	const countCache = new Map<string, number>();
	const ledgers = new Map<string, Map<string, boolean>>();

	function clearRendered(): void {
		for (const state of displayed) {
			if (
				state.text.isConnected &&
				state.text.textContent === state.injectedText
			)
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
		displayed.clear();
	}

	function ledgerFor(rootId: string): Map<string, boolean> {
		const existing = ledgers.get(rootId);
		if (existing) {
			ledgers.delete(rootId);
			ledgers.set(rootId, existing);
			return existing;
		}
		const ledger = new Map<string, boolean>();
		ledgers.set(rootId, ledger);
		while (ledgers.size > MAX_CACHED_THREADS) {
			const oldest = ledgers.keys().next().value;
			if (!oldest) break;
			ledgers.delete(oldest);
			countCache.delete(oldest);
		}
		return ledger;
	}

	function record(mainTweet: Element): number | null {
		const conversation = mainTweet.closest('section[role="region"]');
		const rootId = tweetIdOf(mainTweet);
		if (!conversation || !rootId) return null;
		const ledger = ledgerFor(rootId);
		const discoverMore = [...conversation.querySelectorAll("h1, h2, h3")].find(
			(heading) => DISCOVER_MORE_RE.test(heading.textContent?.trim() ?? ""),
		);
		for (const article of conversation.querySelectorAll(
			options.articleSelector,
		)) {
			const afterMain = Boolean(
				mainTweet.compareDocumentPosition(article) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			);
			const afterDiscoverMore = Boolean(
				discoverMore &&
					discoverMore.compareDocumentPosition(article) &
						Node.DOCUMENT_POSITION_FOLLOWING,
			);
			if (
				article === mainTweet ||
				article.parentElement?.closest(options.articleSelector) ||
				!afterMain ||
				afterDiscoverMore ||
				options.isPromotedPost(article)
			)
				continue;
			const replyId = tweetIdOf(article);
			if (replyId)
				ledger.set(
					replyId,
					!options.rowOf(article).classList.contains(options.filteredClass),
				);
		}
		return [...ledger.values()].filter(Boolean).length;
	}

	function render(article: Element, count: number): void {
		const button = article.querySelector<HTMLButtonElement>(
			'button[data-testid="reply"]',
		);
		const container = button?.querySelector<HTMLElement>(
			'[data-testid="app-text-transition-container"]',
		);
		const text = container?.firstElementChild;
		if (!button || !(text instanceof HTMLElement)) return;
		const formatted = count.toLocaleString();
		let state = [...displayed].find((item) => item.button === button);
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
			displayed.add(state);
		} else {
			if (text.textContent !== state.injectedText)
				state.originalText = text.textContent ?? "";
			const aria = button.getAttribute("aria-label");
			if (aria !== state.injectedAria) state.originalAria = aria;
			const groupAria = state.group?.getAttribute("aria-label") ?? null;
			if (groupAria !== state.injectedGroupAria)
				state.originalGroupAria = groupAria;
		}
		const aria = replaceCount(state.originalAria, formatted);
		const groupAria = replaceCount(state.originalGroupAria, formatted);
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

	return {
		updateDetail(enabled) {
			if (!enabled || !options.isStatusPage()) {
				clearRendered();
				return;
			}
			const mainTweet = [
				...document.querySelectorAll(options.articleSelector),
			].find(options.isMainTweet);
			if (!mainTweet) return;
			const count = record(mainTweet);
			if (count === null) return;
			const id = tweetIdOf(mainTweet);
			if (id) countCache.set(id, count);
			render(mainTweet, count);
		},
		updateTimeline(enabled) {
			if (!enabled || !options.isHomeTimeline()) return;
			for (const article of document.querySelectorAll(
				options.articleSelector,
			)) {
				const id = tweetIdOf(article);
				const count = id ? countCache.get(id) : undefined;
				if (count !== undefined) render(article, count);
			}
		},
		clearRendered,
		clearCaches() {
			countCache.clear();
			ledgers.clear();
		},
	};
}
