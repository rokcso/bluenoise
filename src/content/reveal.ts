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
	let pointerTarget: Element | null = null;
	let preferEventTarget = true;
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
		// Only this controller ever adds the revealing class, and only to one row
		// at a time, so the tracked reference is the complete state. Scanning the
		// document here ran on every pointermove and was the main freeze source.
		if (!reveal) return;
		if (reveal.reason) clearReason(reveal.reason);
		clearRow(reveal.row as HTMLElement);
		reveal = null;
	}

	function hide(): void {
		if (syncFrame) window.cancelAnimationFrame(syncFrame);
		syncFrame = 0;
		pointer = null;
		pointerTarget = null;
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
		pointerTarget = event.target instanceof Element ? event.target : null;
		// Coalesce to one rAF per frame: a media viewer produces hundreds of
		// pointermove events per second while panning, and each one used to force
		// layout reads and style writes on the main thread.
		schedulePointerSync(true);
	}

	function syncToPointer(): void {
		if (!pointer) {
			hide();
			return;
		}
		const target =
			preferEventTarget && pointerTarget?.isConnected
				? pointerTarget
				: document.elementFromPoint(pointer.x, pointer.y);
		const row = target?.closest(`.${options.filteredClass}`) ?? null;
		if (row) show(row, pointer.x, pointer.y);
		else hide();
	}

	function schedulePointerSync(useEventTarget: boolean): void {
		preferEventTarget = useEventTarget;
		if (syncFrame) return;
		// A test double may run the callback synchronously; only store the frame id
		// when the rAF has not already completed.
		let ran = false;
		const frame = window.requestAnimationFrame(() => {
			ran = true;
			syncFrame = 0;
			syncToPointer();
		});
		if (!ran) syncFrame = frame;
	}

	function onScroll(): void {
		schedulePointerSync(false);
	}

	function onResize(): void {
		schedulePointerSync(false);
	}

	return {
		start() {
			if (started) return;
			started = true;
			document.addEventListener("pointermove", onPointerMove);
			window.addEventListener("scroll", onScroll, {
				capture: true,
				passive: true,
			});
			window.addEventListener("resize", onResize, {
				passive: true,
			});
		},
		stop() {
			if (!started) return;
			started = false;
			document.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("scroll", onScroll, {
				capture: true,
			});
			window.removeEventListener("resize", onResize);
			if (syncFrame) window.cancelAnimationFrame(syncFrame);
			syncFrame = 0;
			pointer = null;
			pointerTarget = null;
			hide();
		},
		hide,
	};
}
