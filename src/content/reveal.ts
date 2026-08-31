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
	let pointer: { x: number; y: number } | null = null;
	let syncFrame = 0;
	let started = false;

	function clearReason(reason: HTMLElement): void {
		reason.classList.remove("bluenoise-filter-reason-revealing");
		reason.style.removeProperty("--bluenoise-reason-reveal-x");
		reason.style.removeProperty("--bluenoise-reason-reveal-y");
		reason.style.removeProperty("--bluenoise-reason-reveal-radius");
	}

	function clearRow(row: HTMLElement): void {
		row.classList.remove("bluenoise-revealing");
		row.style.removeProperty("--bluenoise-reveal-x");
		row.style.removeProperty("--bluenoise-reveal-y");
		row.style.removeProperty("--bluenoise-reveal-radius");
	}

	function clearReveal(): void {
		if (reveal?.reason) clearReason(reveal.reason);
		if (reveal) clearRow(reveal.row as HTMLElement);
		// X can replace a virtualized row between pointer events. Clean orphaned
		// state as well as the controller's current reference.
		for (const row of document.querySelectorAll<HTMLElement>(
			".bluenoise-revealing",
		))
			clearRow(row);
		for (const reason of document.querySelectorAll<HTMLElement>(
			".bluenoise-filter-reason-revealing",
		))
			clearReason(reason);
		reveal = null;
	}

	function hide(): void {
		if (syncFrame) window.cancelAnimationFrame(syncFrame);
		syncFrame = 0;
		pointer = null;
		clearReveal();
	}

	function show(row: Element, x: number, y: number): void {
		if (!options.isEnabled()) {
			clearReveal();
			return;
		}
		if (!reveal || reveal.row !== row) {
			const rect = row.getBoundingClientRect();
			if (!rect.width || !rect.height) {
				hide();
				return;
			}
			clearReveal();
			reveal = {
				row,
				reason: row.querySelector<HTMLElement>(
					`:scope > .${options.reasonClass}`,
				),
			};
			(row as HTMLElement).classList.add("bluenoise-revealing");
		}

		const rowRect = reveal.row.getBoundingClientRect();
		const rowElement = reveal.row as HTMLElement;
		rowElement.style.setProperty(
			"--bluenoise-reveal-x",
			`${x - rowRect.left}px`,
		);
		rowElement.style.setProperty(
			"--bluenoise-reveal-y",
			`${y - rowRect.top}px`,
		);
		rowElement.style.setProperty(
			"--bluenoise-reveal-radius",
			`${options.radius}px`,
		);
		if (reveal.reason) {
			const reasonRect = reveal.reason.getBoundingClientRect();
			reveal.reason.classList.add("bluenoise-filter-reason-revealing");
			reveal.reason.style.setProperty(
				"--bluenoise-reason-reveal-x",
				`${x - reasonRect.left}px`,
			);
			reveal.reason.style.setProperty(
				"--bluenoise-reason-reveal-y",
				`${y - reasonRect.top}px`,
			);
			reveal.reason.style.setProperty(
				"--bluenoise-reason-reveal-radius",
				`${options.radius}px`,
			);
		}
	}

	function onPointerMove(event: PointerEvent): void {
		pointer = { x: event.clientX, y: event.clientY };
		const target = event.target;
		const row =
			target instanceof Element
				? target.closest(`.${options.filteredClass}`)
				: null;
		if (row) show(row, event.clientX, event.clientY);
		else hide();
	}

	function syncToPointer(): void {
		syncFrame = 0;
		if (!pointer) {
			hide();
			return;
		}
		const target = document.elementFromPoint(pointer.x, pointer.y);
		const row = target?.closest(`.${options.filteredClass}`) ?? null;
		if (row) show(row, pointer.x, pointer.y);
		else hide();
	}

	function schedulePointerSync(): void {
		if (syncFrame) return;
		syncFrame = window.requestAnimationFrame(syncToPointer);
	}

	return {
		start() {
			if (started) return;
			started = true;
			document.addEventListener("pointermove", onPointerMove);
			window.addEventListener("scroll", schedulePointerSync, {
				capture: true,
				passive: true,
			});
			window.addEventListener("resize", schedulePointerSync, {
				passive: true,
			});
		},
		stop() {
			if (!started) return;
			started = false;
			document.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("scroll", schedulePointerSync, {
				capture: true,
			});
			window.removeEventListener("resize", schedulePointerSync);
			if (syncFrame) window.cancelAnimationFrame(syncFrame);
			syncFrame = 0;
			pointer = null;
			hide();
		},
		hide,
	};
}
