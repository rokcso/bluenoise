import { afterEach, describe, expect, it } from "vitest";
import { mutationMayChangePreset } from "@/src/content/preset-mutation";

class FakeElement {
	constructor(
		private marker = false,
		private descendantMarker = false,
	) {}
	matches(): boolean {
		return this.marker;
	}
	querySelector(): FakeElement | null {
		return this.descendantMarker ? new FakeElement(true) : null;
	}
}

describe("preset mutation detection", () => {
	const originalElement = globalThis.Element;
	afterEach(() => Object.assign(globalThis, { Element: originalElement }));

	it("invalidates a cached article when delayed ad markup is inserted", () => {
		Object.assign(globalThis, { Element: FakeElement });
		const record = {
			target: new FakeElement(false),
			addedNodes: [new FakeElement(false, true)],
		} as unknown as MutationRecord;

		expect(mutationMayChangePreset(record)).toBe(true);
	});

	it("ignores unrelated layout mutations", () => {
		Object.assign(globalThis, { Element: FakeElement });
		const record = {
			target: new FakeElement(false),
			addedNodes: [new FakeElement(false)],
		} as unknown as MutationRecord;

		expect(mutationMayChangePreset(record)).toBe(false);
	});
});
