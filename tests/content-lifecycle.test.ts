import { describe, expect, it, vi } from "vitest";
import { handleContentProcessingError } from "../src/content/lifecycle";

describe("content script lifecycle", () => {
	it("silently stops an obsolete batch when Chrome invalidates its context", () => {
		const teardown = vi.fn();
		const report = vi.fn();

		const shouldContinue = handleContentProcessingError(
			new Error("Extension context invalidated."),
			teardown,
			report,
		);

		expect(shouldContinue).toBe(false);
		expect(teardown).toHaveBeenCalledOnce();
		expect(report).not.toHaveBeenCalled();
	});

	it("keeps reporting genuine item-processing failures", () => {
		const teardown = vi.fn();
		const report = vi.fn();
		const error = new Error("broken article");

		const shouldContinue = handleContentProcessingError(
			error,
			teardown,
			report,
		);

		expect(shouldContinue).toBe(true);
		expect(teardown).not.toHaveBeenCalled();
		expect(report).toHaveBeenCalledWith(error);
	});
});
