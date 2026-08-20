import { describe, expect, it, vi } from "vitest";
import {
	type AccountListSnapshot,
	type AccountListSource,
	buildAccountListIndex,
	matchAccountIndex,
	normalizeAccountHandle,
	syncAccountListSource,
	syncAccountLists,
} from "@/src/domain/account-list";

const snapshot: AccountListSnapshot = {
	version: 1,
	blacklistIds: ["123"],
	blacklistHandles: ["spam_bot"],
	whitelistIds: ["456"],
	whitelistHandles: ["trusted"],
	blacklistCount: 2,
	whitelistCount: 2,
	syncedAt: 1,
};

const metaSource: AccountListSource = {
	id: "mxga",
	name: "MXGA",
	blacklistUrl: "https://example.test/lite.json",
	whitelistUrl: "https://example.test/whitelist",
	metaUrl: "https://example.test/meta",
	artifactBaseUrl: "https://example.test",
};

/** Build N valid lite rows: [userId, handle, code]. */
function liteRows(n: number, prefix = "100000"): [string, string, string][] {
	return Array.from({ length: n }, (_, i) => [
		String(prefix + i),
		`bot_${i}`,
		"sp",
	]);
}

describe("account list providers", () => {
	it("normalizes handles", () => {
		expect(normalizeAccountHandle(" @Spam_Bot ")).toBe("spam_bot");
	});

	it("gives whitelist precedence over blacklist", () => {
		const index = buildAccountListIndex(snapshot);
		expect(matchAccountIndex(index, { id: "456", handle: "spam_bot" })).toBe(
			"whitelist",
		);
	});

	it("matches immutable ids and handle fallback", () => {
		const index = buildAccountListIndex(snapshot);
		expect(matchAccountIndex(index, { id: "123" })).toBe("blacklist");
		expect(matchAccountIndex(index, { handle: "@SPAM_BOT" })).toBe("blacklist");
		expect(matchAccountIndex(index, { handle: "unknown" })).toBeNull();
	});

	it("supports local rules with local whitelist precedence", () => {
		const index = buildAccountListIndex(snapshot);
		expect(
			matchAccountIndex(index, { handle: "local_spam" }, [], ["@local_spam"]),
		).toBe("blacklist");
		expect(
			matchAccountIndex(
				index,
				{ handle: "local_spam" },
				["@local_spam"],
				["@local_spam"],
			),
		).toBe("whitelist");
	});

	it("gives local blacklist precedence over external whitelist", () => {
		const index = buildAccountListIndex(snapshot);
		// Account 456 is on the external whitelist but also on the local blacklist:
		// the local blacklist must win.
		expect(matchAccountIndex(index, { id: "456" }, [], ["456"])).toBe(
			"blacklist",
		);
	});

	it("keeps successful providers when another provider fails", async () => {
		const good: AccountListSource = {
			id: "good",
			name: "Good",
			blacklistUrl: "https://example.test/good-blacklist",
			whitelistUrl: "https://example.test/good-whitelist",
		};
		const bad: AccountListSource = {
			id: "bad",
			name: "Bad",
			blacklistUrl: "https://example.test/bad-blacklist",
			whitelistUrl: "https://example.test/bad-whitelist",
		};
		const goodRows = liteRows(1200, "7000");
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url.includes("bad")) return new Response("no", { status: 503 });
				if (url.includes("blacklist"))
					return Response.json({
						schema: 2,
						generatedAt: 3,
						entries: goodRows,
					});
				return Response.json({ list: [] });
			}),
		);
		const result = await syncAccountLists([good, bad]);
		expect(result.blacklistIds).toHaveLength(1200);
		expect(result.blacklistIds[0]).toBe("70000");
		expect(result.sources).toEqual(["good"]);
		expect(result.syncError).toContain("bad");
		vi.unstubAllGlobals();
	});

	it("carries over hydrated blacklist when the remote version is unchanged", async () => {
		const previous: AccountListSnapshot = {
			version: 99,
			blacklistIds: ["100", "200"],
			blacklistHandles: ["a", "b"],
			whitelistIds: [],
			whitelistHandles: [],
			blacklistCount: 2,
			whitelistCount: 0,
			syncedAt: 1,
			sources: ["mxga"],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url.includes("/meta"))
					return Response.json({
						version: "v-9-99",
						artifacts: { lite: "/v1/artifacts/lite-x.json" },
					});
				// Whitelist only — the lite artifact must NOT be re-downloaded.
				return Response.json({
					list: [{ x_user_id: "789", handle: "new_bot" }],
				});
			}),
		);
		const result = await syncAccountListSource(metaSource, previous);
		expect(result.version).toBe(99);
		expect(result.blacklistIds).toEqual(["100", "200"]);
		expect(result.blacklistHandles).toEqual(["a", "b"]);
		expect(result.blacklistCount).toBe(2);
		expect(result.whitelistIds).toEqual(["789"]);
		vi.unstubAllGlobals();
	});

	it("fetches the lite artifact when the remote version changes", async () => {
		const previous: AccountListSnapshot = {
			version: 99,
			blacklistIds: ["100", "200"],
			blacklistHandles: ["a", "b"],
			whitelistIds: [],
			whitelistHandles: [],
			blacklistCount: 2,
			whitelistCount: 0,
			syncedAt: 1,
			sources: ["mxga"],
		};
		const freshRows = liteRows(1200, "5000");
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url.includes("/meta"))
					return Response.json({
						version: "v-9-100",
						artifacts: { lite: "/v1/artifacts/lite-x.json" },
					});
				if (url.includes("/artifacts/lite"))
					return Response.json({
						schema: 2,
						generatedAt: 100,
						entries: freshRows,
					});
				return Response.json({ list: [] });
			}),
		);
		const result = await syncAccountListSource(metaSource, previous);
		expect(result.version).toBe(100);
		expect(result.blacklistIds).toHaveLength(1200);
		expect(result.blacklistIds[0]).toBe("50000");
		vi.unstubAllGlobals();
	});

	it("quarantines a bounded number of invalid lite rows", async () => {
		const rows = liteRows(1200, "6000");
		rows[5] = ["bad"] as unknown as [string, string, string];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url.includes("/meta"))
					return Response.json({
						version: "v-9-200",
						artifacts: { lite: "/v1/artifacts/lite-x.json" },
					});
				if (url.includes("/artifacts/lite"))
					return Response.json({ schema: 2, generatedAt: 200, entries: rows });
				return Response.json({ list: [] });
			}),
		);
		const result = await syncAccountListSource(metaSource);
		expect(result.blacklistIds).toHaveLength(1199);
		vi.unstubAllGlobals();
	});

	it("rejects an implausibly small blacklist", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url.includes("/meta"))
					return Response.json({
						version: "v-9-300",
						artifacts: { lite: "/v1/artifacts/lite-x.json" },
					});
				if (url.includes("/artifacts/lite"))
					return Response.json({
						schema: 2,
						generatedAt: 300,
						entries: [["1", "only_one", "sp"]],
					});
				return Response.json({ list: [] });
			}),
		);
		await expect(syncAccountListSource(metaSource)).rejects.toThrow(
			"Implausibly small account list",
		);
		vi.unstubAllGlobals();
	});
});
