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

/** Apply the ad switches while remaining stable during X's staged creative render. */
export function shouldFilterPromotedPost(
	article: Element,
	options: { media: boolean; card: boolean },
): boolean {
	if (!isPromotedPost(article)) return false;
	// Together the two switches express "filter promoted creatives". Do not let
	// a temporarily absent media/card subtree make that decision oscillate.
	if (options.media && options.card) return true;
	if (
		options.media &&
		article.querySelector(
			'[data-testid="videoPlayer"], [data-testid="tweetPhoto"]',
		)
	)
		return true;
	return Boolean(
		options.card && article.querySelector('[data-testid="card.wrapper"]'),
	);
}
