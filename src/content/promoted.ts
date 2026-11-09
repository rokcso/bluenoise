import {
	CARD_SEL,
	CELL_SEL,
	MEDIA_SEL,
	PLACEMENT_SEL,
} from "@/src/content/selectors";

/** X wraps promoted articles in placementTracking; media can contain it too. */
export function isPromotedPost(article: Element): boolean {
	const cell = article.closest(CELL_SEL);
	if (!cell) return false;

	let node = article.parentElement;
	while (node) {
		if (node.matches(PLACEMENT_SEL)) return true;
		if (node === cell) return false;
		node = node.parentElement;
	}
	return false;
}

/** A promoted post whose payload is a video or image. */
export function isMediaAd(article: Element): boolean {
	return isPromotedPost(article) && Boolean(article.querySelector(MEDIA_SEL));
}

/** A promoted post whose payload is a link card. */
export function isCardAd(article: Element): boolean {
	return isPromotedPost(article) && Boolean(article.querySelector(CARD_SEL));
}
