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
	row: Element;
	reason: HTMLElement | null;
}

/** Owns the pointer spotlight overlay, reason mask, and related listeners. */
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
		if (reveal) {
			const row = reveal.row as HTMLElement;
			row.classList.remove("xsf-revealing");
			row.style.removeProperty("--xsf-reveal-x");
			row.style.removeProperty("--xsf-reveal-y");
			row.style.removeProperty("--xsf-reveal-radius");
		}
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
			reveal = {
				row,
				reason: row.querySelector<HTMLElement>(
					`:scope > .${options.reasonClass}`,
				),
			};
			(row as HTMLElement).classList.add("xsf-revealing");
		}

		const rowRect = reveal.row.getBoundingClientRect();
		const rowElement = reveal.row as HTMLElement;
		rowElement.style.setProperty("--xsf-reveal-x", `${x - rowRect.left}px`);
		rowElement.style.setProperty("--xsf-reveal-y", `${y - rowRect.top}px`);
		rowElement.style.setProperty("--xsf-reveal-radius", `${options.radius}px`);
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
