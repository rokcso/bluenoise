/**
 * Presentation of a filtered tweet: dim / collapse / hide marks, the reason
 * label, the collapse placeholder and its height animation.
 *
 * This module owns the DOM it writes and nothing else — it never decides
 * whether something should be filtered (`evaluation.ts`) and never schedules
 * work (`content.ts`). That split is what makes the marking rules testable in
 * a plain DOM instead of a real X page.
 */

import { t } from "@/lib/i18n";
import {
	type FilterReason,
	formatFilterReason,
} from "@/src/content/filter-reason";
import { rowOf } from "@/src/content/selectors";
import type { AppConfig } from "@/src/contracts/config";

/** Marks the row X rendered around a matched tweet. */
export const FILTERED_CLASS = "bluenoise-filtered";
/** Carries the matched rule so other features can read it back. */
export const HIT_ATTR = "data-bluenoise-keyword";
/** The "filtered because …" label inside a dimmed row. */
export const REASON_CLASS = "bluenoise-filter-reason";
/** Placeholder that stands in for a collapsed row. */
export const COLLAPSE_CLASS = "bluenoise-collapse-placeholder";
/** Set on a collapsed row while the user has expanded it. */
export const COLLAPSE_EXPANDED_CLASS = "bluenoise-collapse-expanded";
/** Set on rows made inert, so teardown can find them again. */
const INERT_ATTR = "data-bluenoise-inert";

export interface TweetMarker {
	/** Apply (or clear) the mark that `hit` implies on this tweet's row. */
	applyMark(
		article: Element,
		hit: string | null,
		reason?: FilterReason | null,
	): void;
	/** Remove every mark this module owns. */
	clearAll(): void;
	/** Re-apply hide-mode inertness after a mode change without re-evaluating. */
	syncInteractivity(): void;
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

export function createTweetMarker(options: {
	getConfig(): AppConfig;
}): TweetMarker {
	const collapseAnimations = new WeakMap<Element, Animation>();

	function animateCollapseResize(row: Element, beforeHeight: number): void {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const afterHeight = row.getBoundingClientRect().height;
		if (Math.abs(afterHeight - beforeHeight) < 1) return;
		const animation = row.animate(
			[
				{ height: `${beforeHeight}px`, overflow: "clip" },
				{ height: `${afterHeight}px`, overflow: "clip" },
			],
			{ duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" },
		);
		collapseAnimations.set(row, animation);
		const forget = () => {
			if (collapseAnimations.get(row) === animation)
				collapseAnimations.delete(row);
		};
		animation.addEventListener("finish", forget, { once: true });
		animation.addEventListener("cancel", forget, { once: true });
	}

	function syncCollapsePlaceholder(
		row: Element,
		reason: FilterReason | null,
	): void {
		const cfg = options.getConfig();
		let placeholder = row.querySelector<HTMLElement>(
			`:scope > .${COLLAPSE_CLASS}`,
		);
		if (cfg.mode !== "collapse") {
			placeholder?.remove();
			row.classList.remove(COLLAPSE_EXPANDED_CLASS);
			return;
		}
		if (!placeholder) {
			placeholder = document.createElement("div");
			placeholder.className = COLLAPSE_CLASS;
			const button = document.createElement("button");
			button.type = "button";
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				const beforeHeight = row.getBoundingClientRect().height;
				collapseAnimations.get(row)?.cancel();
				const expanded = row.classList.toggle(COLLAPSE_EXPANDED_CLASS);
				button.setAttribute("aria-expanded", String(expanded));
				const action = button.querySelector<HTMLElement>(
					"[data-bluenoise-collapse-action]",
				);
				if (action)
					action.textContent = t(expanded ? "collapse_again" : "collapse_show");
				animateCollapseResize(row, beforeHeight);
			});
			placeholder.append(button);
			row.prepend(placeholder);
		}

		const button = placeholder.querySelector("button");
		if (!button) return;
		button.setAttribute(
			"aria-expanded",
			String(row.classList.contains(COLLAPSE_EXPANDED_CLASS)),
		);
		const detail =
			reason && cfg.showFilterReason ? formatFilterReason(reason, t) : "";
		button.replaceChildren();
		const summary = document.createElement("span");
		summary.className = "bluenoise-collapse-summary";
		summary.textContent = detail
			? t("collapse_filtered_reason", detail)
			: t("collapse_filtered");
		const action = document.createElement("span");
		action.className = "bluenoise-collapse-action";
		action.setAttribute("data-bluenoise-collapse-action", "");
		action.textContent = t(
			row.classList.contains(COLLAPSE_EXPANDED_CLASS)
				? "collapse_again"
				: "collapse_show",
		);
		button.append(summary, action);
	}

	function applyMark(
		article: Element,
		hit: string | null,
		reason: FilterReason | null = null,
	): void {
		const cfg = options.getConfig();
		const row = rowOf(article);
		if (hit) {
			setRowInert(row, cfg.mode === "hide");
			row.classList.add(FILTERED_CLASS);
			row.setAttribute(HIT_ATTR, hit);
			syncCollapsePlaceholder(row, reason);
			let label = row.querySelector<HTMLElement>(`:scope > .${REASON_CLASS}`);
			if (reason && cfg.mode === "dim" && cfg.showFilterReason) {
				const detail = formatFilterReason(reason, t);
				const text = t("filter_reason_label", detail);
				if (!label) {
					label = document.createElement("div");
					label.className = REASON_CLASS;
					row.append(label);
				}
				label.textContent = text;
				label.title = text;
			} else {
				label?.remove();
			}
		} else if (row.classList.contains(FILTERED_CLASS)) {
			row.classList.remove(FILTERED_CLASS);
			row.classList.remove(COLLAPSE_EXPANDED_CLASS);
			row.removeAttribute(HIT_ATTR);
			row.querySelector(`:scope > .${REASON_CLASS}`)?.remove();
			row.querySelector(`:scope > .${COLLAPSE_CLASS}`)?.remove();
			setRowInert(row, false);
		}
	}

	function clearAll(): void {
		for (const el of document.querySelectorAll(`.${FILTERED_CLASS}`)) {
			el.classList.remove(FILTERED_CLASS);
			el.classList.remove(COLLAPSE_EXPANDED_CLASS);
			el.classList.remove("bluenoise-revealing");
			el.removeAttribute(HIT_ATTR);
			el.querySelector(`:scope > .${REASON_CLASS}`)?.remove();
			el.querySelector(`:scope > .${COLLAPSE_CLASS}`)?.remove();
			setRowInert(el, false);
		}
	}

	function syncInteractivity(): void {
		const hideMode = options.getConfig().mode === "hide";
		for (const row of document.querySelectorAll(`.${FILTERED_CLASS}`))
			setRowInert(row, hideMode);
	}

	return { applyMark, clearAll, syncInteractivity };
}
