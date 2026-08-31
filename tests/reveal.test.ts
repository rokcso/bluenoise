import { afterEach, describe, expect, it, vi } from "vitest";
import { createRevealController } from "../src/content/reveal";

class FakeElement {
	classList = {
		values: new Set<string>(),
		add: (name: string) => this.classList.values.add(name),
		remove: (name: string) => this.classList.values.delete(name),
		contains: (name: string) => this.classList.values.has(name),
	};
	style = {
		values: new Map<string, string>(),
		setProperty: (name: string, value: string) =>
			this.style.values.set(name, value),
		removeProperty: (name: string) => this.style.values.delete(name),
	};

	closest(selector: string): FakeElement | null {
		return selector === ".filtered" && this.classList.contains("filtered")
			? this
			: null;
	}

	querySelector(): null {
		return null;
	}

	getBoundingClientRect(): DOMRect {
		return { left: 10, top: 20, width: 300, height: 120 } as DOMRect;
	}
}

describe("reveal controller", () => {
	const originalDocument = globalThis.document;
	const originalWindow = globalThis.window;
	const originalElement = globalThis.Element;

	afterEach(() => {
		vi.restoreAllMocks();
		Object.assign(globalThis, {
			document: originalDocument,
			window: originalWindow,
			Element: originalElement,
		});
	});

	it("keeps reveal aligned with the row under the pointer while scrolling", () => {
		const documentListeners = new Map<string, EventListener>();
		const windowListeners = new Map<string, EventListener>();
		const firstRow = new FakeElement();
		const nextRow = new FakeElement();
		firstRow.classList.add("filtered");
		nextRow.classList.add("filtered");
		const elementFromPoint = vi.fn(() => nextRow);
		Object.assign(globalThis, {
			Element: FakeElement,
			document: {
				addEventListener: (type: string, listener: EventListener) =>
					documentListeners.set(type, listener),
				removeEventListener: vi.fn(),
				elementFromPoint,
				querySelectorAll: () => [],
			},
			window: {
				addEventListener: (type: string, listener: EventListener) =>
					windowListeners.set(type, listener),
				removeEventListener: vi.fn(),
				requestAnimationFrame: (callback: FrameRequestCallback) => {
					callback(0);
					return 1;
				},
				cancelAnimationFrame: vi.fn(),
			},
		});

		const controller = createRevealController({
			filteredClass: "filtered",
			hitAttribute: "data-hit",
			reasonClass: "reason",
			radius: 40,
			isEnabled: () => true,
		});
		controller.start();
		documentListeners.get("pointermove")?.({
			target: firstRow,
			clientX: 80,
			clientY: 90,
		} as unknown as Event);
		expect(firstRow.classList.contains("bluenoise-revealing")).toBe(true);

		windowListeners.get("scroll")?.(new Event("scroll"));

		expect(elementFromPoint).toHaveBeenCalledWith(80, 90);
		expect(firstRow.classList.contains("bluenoise-revealing")).toBe(false);
		expect(nextRow.classList.contains("bluenoise-revealing")).toBe(true);
	});

	it("hide clears orphaned reveal classes and CSS variables", () => {
		const orphan = new FakeElement();
		orphan.classList.add("bluenoise-revealing");
		orphan.style.setProperty("--bluenoise-reveal-x", "20px");
		Object.assign(globalThis, {
			Element: FakeElement,
			document: {
				querySelectorAll: (selector: string) =>
					selector === ".bluenoise-revealing" ? [orphan] : [],
			},
			window: { cancelAnimationFrame: vi.fn() },
		});
		const controller = createRevealController({
			filteredClass: "filtered",
			hitAttribute: "data-hit",
			reasonClass: "reason",
			radius: 40,
			isEnabled: () => false,
		});

		controller.hide();

		expect(orphan.classList.contains("bluenoise-revealing")).toBe(false);
		expect(orphan.style.values.has("--bluenoise-reveal-x")).toBe(false);
	});
});
