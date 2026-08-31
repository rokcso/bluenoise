const PRESET_MARKER_SEL = [
	'[data-testid="placementTracking"]',
	'[data-testid="videoPlayer"]',
	'[data-testid="tweetPhoto"]',
	'[data-testid="card.wrapper"]',
	'a[href="https://help.x.com/rules-and-policies/authenticity"]',
].join(", ");

/** True when a DOM mutation can change an article's preset classification. */
export function mutationMayChangePreset(record: MutationRecord): boolean {
	const target = record.target;
	if (target instanceof Element && target.matches(PRESET_MARKER_SEL))
		return true;
	return [...record.addedNodes].some(
		(node) =>
			node instanceof Element &&
			(node.matches(PRESET_MARKER_SEL) ||
				Boolean(node.querySelector(PRESET_MARKER_SEL))),
	);
}
