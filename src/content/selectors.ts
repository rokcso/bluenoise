/**
 * Every place BlueNoise reads X's DOM lives here.
 *
 * X ships obfuscated class names and reshuffles them regularly, but the
 * `data-testid` / `role` contract below has been stable for years and is what
 * the official client relies on too. Keeping it in one module means a X
 * redesign is a single-file diff instead of a scavenger hunt, and it lets the
 * rest of the code talk about "the tweet text" rather than about a selector.
 *
 * Only pure DOM reads belong here: no config, no storage, no filtering
 * decisions. Those live in `evaluation.ts` / `marking.ts`.
 */

import { readFiberUserId } from "@/src/content/fiber";
import type { AccountIdentity } from "@/src/domain/account-list";

/* ---------- X's DOM contract ---------- */

/** A tweet in a timeline or in a conversation. */
export const ARTICLE_SEL =
	'article[data-testid="tweet"], article[role="article"]';
/** X's virtualized row wrapper. Filtering marks the row, not the article. */
export const CELL_SEL = 'div[data-testid="cellInnerDiv"]';
/** The body text node of a tweet. */
export const TWEET_TEXT_SEL =
	'[data-testid="tweetText"], [data-testid="postText"]';
/** The author block (display name + @handle). */
export const USER_NAME_SEL =
	'[data-testid="User-Name"], [data-testid="userName"]';
/** Wrapper X puts around a promoted post inside a cell. */
export const PLACEMENT_SEL = '[data-testid="placementTracking"]';
/** Media containers, used to classify media-only ads. */
export const MEDIA_SEL =
	'[data-testid="videoPlayer"], [data-testid="tweetPhoto"]';
/** Link-card container, used to classify card ads. */
export const CARD_SEL = '[data-testid="card.wrapper"]';
/** Official link X attaches to accounts it labels (parody / fan / automated). */
export const AUTHENTICITY_LINK_SEL =
	'a[href="https://help.x.com/rules-and-policies/authenticity"]';
/** Any link pointing at a status; the one wrapping <time> is the tweet's own. */
export const STATUS_LINK_SEL = 'a[href*="/status/"]';
/** X's dropdown portal and the ⋯ button that opens it. */
export const MENU_SEL = '[data-testid="Dropdown"]';
export const MENU_OPENER_SEL = '[data-testid="caret"][aria-haspopup="menu"]';
/** The conversation column; used to notice reply-list updates. */
export const REGION_SEL = 'section[role="region"]';

/**
 * Every node whose appearance can change an article's preset classification
 * (ad / parody / fan / commentary / automated). A mutation touching any of
 * these invalidates the cached classification.
 */
export const PRESET_MARKER_SEL = [
	PLACEMENT_SEL,
	MEDIA_SEL,
	CARD_SEL,
	AUTHENTICITY_LINK_SEL,
].join(", ");

/* ---------- Route reads ---------- */

/** Numeric status id of a tweet detail page, or null on any other route. */
export function statusIdFromPath(pathname: string): string | null {
	return pathname.match(/^\/[^/]+\/status\/(\d+)/)?.[1] ?? null;
}

/** Tweet detail pages are the only place where the opened post is exempt. */
export function isStatusPath(pathname: string): boolean {
	return statusIdFromPath(pathname) !== null;
}

/** "For You" and "Following" share the /home route. */
export function isHomePath(pathname: string): boolean {
	return pathname === "/home";
}

/** Pages where filtering applies: tweet detail pages and the home timeline. */
export function isFilterablePath(pathname: string): boolean {
	return isStatusPath(pathname) || isHomePath(pathname);
}

/* ---------- Element reads ---------- */

/**
 * Read text, newlines and image alts in DOM order for accurate matching.
 *
 * X renders line breaks as <br>, paragraphs as <div>/<p>, and puts meaningful
 * words in image `alt` text, so textContent alone both loses line structure and
 * drops content that a keyword rule should see.
 */
export function readTextContent(el: Element | null): string {
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

/** Body text of a tweet. */
export function readTweetText(article: Element): string {
	return readTextContent(article.querySelector(TWEET_TEXT_SEL));
}

/** Author display name area, only read when the user opted into name matching. */
export function readAuthorName(article: Element): string {
	return readTextContent(article.querySelector(USER_NAME_SEL));
}

/** The cell row X renders around an article, or the article itself. */
export function rowOf(article: Element): Element {
	return article.closest(CELL_SEL) ?? article;
}

/** Numeric id of the tweet rendered by `article`, read from its own permalink. */
export function tweetIdOf(article: Element): string | null {
	for (const link of article.querySelectorAll<HTMLAnchorElement>(
		STATUS_LINK_SEL,
	)) {
		if (!link.querySelector("time")) continue;
		const id = link.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1];
		if (id) return id;
	}
	return null;
}

/**
 * The main tweet (the one you opened) is never filtered — only replies are.
 * This exemption only exists on status pages; on the home timeline every tweet
 * is a filtering candidate.
 */
export function isMainTweetArticle(
	article: Element,
	statusId: string | null,
): boolean {
	if (!statusId) return false;
	if (tweetIdOf(article) === statusId) return true;
	return article === document.querySelector(ARTICLE_SEL);
}

/** X's localized account label, read from its official authenticity link. */
export function readAccountLabel(article: Element): string {
	return (
		article.querySelector(AUTHENTICITY_LINK_SEL)?.textContent?.trim() ?? ""
	);
}

export function isParodyAccount(article: Element): boolean {
	return /^(戏仿账号|parody account)$/i.test(readAccountLabel(article));
}

export function isFanAccount(article: Element): boolean {
	return /^(粉丝账号|fan account)$/i.test(readAccountLabel(article));
}

export function isCommentaryAccount(article: Element): boolean {
	return /^(评论账号|评论性账号|commentary account)$/i.test(
		readAccountLabel(article),
	);
}

/** X displays this account status beside the author handle. */
export function isAutomatedAccount(article: Element): boolean {
	const name = article.querySelector(USER_NAME_SEL);
	return /自动发推|automated account/i.test(name?.textContent ?? "");
}

/**
 * Read the author's identity. Keyword matching only needs the @handle from the
 * DOM; account matching also needs the immutable numeric id, which X does not
 * expose — see fiber.ts.
 */
export function readAuthorIdentity(
	article: Element,
	needId: boolean,
): AccountIdentity {
	const name = article.querySelector(USER_NAME_SEL);
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
	// The fiber walk is budgeted but not free — skip it for keyword-only setups,
	// where the cheap DOM reads below are enough.
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
