export interface RevealController {
	start(): void;
	stop(): void;
	hide(): void;
}

interface RevealOptions {
	filteredClass: string;
	hitAttribute: string;
	reasonClass: string;
	radius: number;
	isEnabled(): boolean;
}

interface RevealState {
	el: HTMLElement;
	row: Element;
	reason: HTMLElement | null;
}

function sanitizeClone(el: HTMLElement): void {
	for (const node of el.querySelectorAll<HTMLElement>("[data-testid]"))
		node.removeAttribute("data-testid");
	el.removeAttribute("data-testid");
}

/** Owns the pointer spotlight clone, reason mask, and all related listeners. */
export function createRevealController(
	options: RevealOptions,
): RevealController {
	let reveal: RevealState | null = null;
	let started = false;

	function hide(): void {
		if (reveal?.reason) {
			reveal.reason.classList.remove("xsf-filter-reason-revealing");
			reveal.reason.style.removeProperty("--xsf-reason-reveal-x");
			reveal.reason.style.removeProperty("--xsf-reason-reveal-y");
			reveal.reason.style.removeProperty("--xsf-reason-reveal-radius");
		}
		reveal?.el.remove();
		reveal = null;
	}

	function show(row: Element, x: number, y: number): void {
		if (!options.isEnabled()) {
			hide();
			return;
		}
		if (!reveal || reveal.row !== row) {
			const rect = row.getBoundingClientRect();
			if (!rect.width || !rect.height) {
				hide();
				return;
			}
			hide();
			const el = row.cloneNode(true) as HTMLElement;
			el.querySelector(`:scope > .${options.reasonClass}`)?.remove();
			el.classList.remove(options.filteredClass);
			el.classList.add("xsf-reveal");
			el.removeAttribute(options.hitAttribute);
			sanitizeClone(el);
			el.inert = true;
			document.body.append(el);
			el.style.left = `${rect.left}px`;
			el.style.top = `${rect.top}px`;
			el.style.width = `${rect.width}px`;
			el.style.height = `${rect.height}px`;
			el.style.margin = "0";
			el.style.setProperty("opacity", "1", "important");
			el.style.setProperty("filter", "none", "important");
			const initialRect = el.getBoundingClientRect();
			el.style.left = `${rect.left + (rect.left - initialRect.left)}px`;
			el.style.top = `${rect.top + (rect.top - initialRect.top)}px`;
			reveal = {
				el,
				row,
				reason: row.querySelector<HTMLElement>(
					`:scope > .${options.reasonClass}`,
				),
			};
		}

		const cloneRect = reveal.el.getBoundingClientRect();
		reveal.el.style.setProperty("--xsf-reveal-x", `${x - cloneRect.left}px`);
		reveal.el.style.setProperty("--xsf-reveal-y", `${y - cloneRect.top}px`);
		reveal.el.style.setProperty("--xsf-reveal-radius", `${options.radius}px`);
		if (reveal.reason) {
			const reasonRect = reveal.reason.getBoundingClientRect();
			reveal.reason.classList.add("xsf-filter-reason-revealing");
			reveal.reason.style.setProperty(
				"--xsf-reason-reveal-x",
				`${x - reasonRect.left}px`,
			);
			reveal.reason.style.setProperty(
				"--xsf-reason-reveal-y",
				`${y - reasonRect.top}px`,
			);
			reveal.reason.style.setProperty(
				"--xsf-reason-reveal-radius",
				`${options.radius}px`,
			);
		}
	}

	function onPointerMove(event: PointerEvent): void {
		const target = event.target;
		const row =
			target instanceof Element
				? target.closest(`.${options.filteredClass}`)
				: null;
		if (row) show(row, event.clientX, event.clientY);
		else hide();
	}

	return {
		start() {
			if (started) return;
			started = true;
			document.addEventListener("pointermove", onPointerMove);
			window.addEventListener("scroll", hide, {
				capture: true,
				passive: true,
			});
			window.addEventListener("resize", hide, { passive: true });
		},
		stop() {
			if (!started) return;
			started = false;
			document.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("scroll", hide, { capture: true });
			window.removeEventListener("resize", hide);
			hide();
		},
		hide,
	};
}
