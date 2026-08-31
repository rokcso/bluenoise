const CELL_SEL = 'div[data-testid="cellInnerDiv"]';
const PLACEMENT_SEL = '[data-testid="placementTracking"]';

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
