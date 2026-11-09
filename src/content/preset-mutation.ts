import { PRESET_MARKER_SEL } from "@/src/content/selectors";

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
