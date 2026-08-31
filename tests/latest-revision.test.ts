import { describe, expect, it } from "vitest";
import { createLatestRevision } from "@/src/content/latest-revision";

describe("latest async revision", () => {
	it("allows only the newest rapid configuration change to apply", async () => {
		const gate = createLatestRevision();
		const applied: string[] = [];
		let resolveFirst: (value: string) => void = () => {};
		let resolveLast: (value: string) => void = () => {};
		const first = new Promise<string>((resolve) => (resolveFirst = resolve));
		const last = new Promise<string>((resolve) => (resolveLast = resolve));

		const run = async (revision: number, value: Promise<string>) => {
			const result = await value;
			if (gate.isCurrent(revision)) applied.push(result);
		};
		const firstRun = run(gate.issue(), first);
		const lastRun = run(gate.issue(), last);
		resolveLast("collapse");
		resolveFirst("dim");
		await Promise.all([firstRun, lastRun]);

		expect(applied).toEqual(["collapse"]);
	});
});
