import { describe, expect, it } from "vitest";
import { readFiberUserId } from "@/src/content/fiber";

function withFiber(value: unknown, fiberValue: unknown): Element {
	(value as Record<string, unknown>).__reactFiber$test = fiberValue;
	return value as unknown as Element;
}

function userNode(opts: {
	restId?: string;
	idStr?: string;
	screenName: string;
}) {
	return {
		__typename: "User",
		...(opts.restId ? { rest_id: opts.restId } : {}),
		legacy: {
			...(opts.idStr ? { id_str: opts.idStr } : {}),
			screen_name: opts.screenName,
			followers_count: 10,
			description: "some bio",
		},
	};
}

describe("readFiberUserId", () => {
	it("returns the immutable numeric id from a User node in the fiber", () => {
		const user = userNode({
			restId: "1888247810040152064",
			idStr: "1888247810040152064",
			screenName: "MrGafish",
		});
		const el = withFiber(
			{},
			{ memoizedProps: { timeline: { tweet: { user } } }, memoizedState: null },
		);
		expect(readFiberUserId(el, "MrGafish")).toBe("1888247810040152064");
	});

	it("falls back to legacy.id_str when rest_id is missing", () => {
		const user = userNode({
			idStr: "1636981205504786434",
			screenName: "op7418",
		});
		const el = withFiber(
			{},
			{ memoizedProps: { data: user }, memoizedState: null },
		);
		expect(readFiberUserId(el, "op7418")).toBe("1636981205504786434");
	});

	it("returns undefined when no handle matches the requested account", () => {
		const user = userNode({ restId: "1", screenName: "someone" });
		const el = withFiber(
			{},
			{ memoizedProps: { data: user }, memoizedState: null },
		);
		expect(readFiberUserId(el, "different_user")).toBeUndefined();
	});

	it("matches a handle even when @-prefixed or mixed case", () => {
		const user = userNode({ restId: "42", screenName: "CuiMao" });
		const el = withFiber(
			{},
			{ memoizedProps: { data: user }, memoizedState: null },
		);
		expect(readFiberUserId(el, "@cuimao")).toBe("42");
	});

	it("returns undefined when no fiber is attached", () => {
		expect(readFiberUserId({} as Element, "handle")).toBeUndefined();
	});

	it("never hangs on a cyclic fiber graph", () => {
		const a: Record<string, unknown> = { __typename: "User", rest_id: "7" };
		const b: Record<string, unknown> = {};
		a.legacy = b;
		a.loop = a;
		b.id_str = "7";
		b.screen_name = "cyclic";
		b.followers_count = 0;
		b.description = "";
		const el = withFiber({}, { memoizedProps: { x: a }, memoizedState: null });
		expect(readFiberUserId(el, "cyclic")).toBe("7");
	});
});
