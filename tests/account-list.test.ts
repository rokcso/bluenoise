import { describe, expect, it, vi } from "vitest";
import {
	type AccountListSnapshot,
	type AccountListSource,
	accountIdentityToStored,
	addAccountToList,
	buildAccountListIndex,
	matchAccountIndex,
	matchAccountSources,
	mergeAccountListSnapshots,
	normalizeAccountHandle,
	parseAccountText,
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
	it("retains the source of account-list matches without returning the account", () => {
		const index = buildAccountListIndex(snapshot);
		expect(
			matchAccountSources([{ id: "mxga", index }], { handle: "spam_bot" }),
		).toEqual({ decision: "blacklist", source: "mxga" });
		expect(
			matchAccountSources(
				[{ id: "mxga", index }],
				{ handle: "local_bot" },
				[],
				["@local_bot"],
			),
		).toEqual({ decision: "blacklist", source: "user" });
	});

	it("normalizes handles", () => {
		expect(normalizeAccountHandle(" @Spam_Bot ")).toBe("spam_bot");
	});

	it("parses one-per-line account lists with comments and duplicates", () => {
		expect(
			parseAccountText(
				"# maintained list\n123\n@Spam_Bot\nspam_bot\ninvalid handle!\n",
			),
		).toEqual({ ids: ["123"], handles: ["spam_bot"] });
	});

	it("syncs a one-per-line provider without a whitelist", async () => {
		const source: AccountListSource = {
			id: "text",
			name: "Text list",
			blacklistUrl: "https://example.test/accounts.txt",
			format: "one-per-line",
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("# comment\n123\n@Spam_Bot\n")),
		);
		const result = await syncAccountListSource(source);
		expect(result.blacklistIds).toEqual(["123"]);
		expect(result.blacklistHandles).toEqual(["spam_bot"]);
		expect(result.whitelistIds).toEqual([]);
		expect(result.sources).toEqual(["text"]);
		vi.unstubAllGlobals();
	});

	it("merges enabled provider snapshots without changing their precedence", () => {
		const combined = mergeAccountListSnapshots([
			snapshot,
			{
				...snapshot,
				version: 2,
				blacklistIds: ["789"],
				blacklistHandles: ["another_bot"],
				sources: ["text"],
			},
		]);
		expect(combined?.blacklistIds).toEqual(["123", "789"]);
		expect(combined?.sources).toEqual(["text"]);
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

	it("follows the whitelist since-cursor to fetch all pages", async () => {
		const total = 2500; // spans two pages at the 2000/page limit
		const all = Array.from({ length: total }, (_, i) => ({
			x_user_id: String(200000 + i),
			handle: `w${i}`,
			last_scored: 1000 + i,
		}));
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url.includes("/meta"))
					return Response.json({
						version: "v-9-999",
						artifacts: { lite: "/v1/artifacts/lite-x.json" },
					});
				if (url.includes("/artifacts/lite"))
					return Response.json({
						schema: 2,
						generatedAt: 999,
						entries: liteRows(1200, "9000"),
					});
				const u = new URL(url);
				const since = Number(u.searchParams.get("since")) || 0;
				const limit = Number(u.searchParams.get("limit")) || 500;
				const page = all.filter((r) => r.last_scored > since).slice(0, limit);
				const latestAt = page.length
					? page[page.length - 1].last_scored
					: since;
				return Response.json({ list: page, latestAt, count: page.length });
			}),
		);
		const result = await syncAccountListSource(metaSource);
		expect(result.whitelistIds).toHaveLength(total);
		expect(result.whitelistIds[0]).toBe("200000");
		expect(result.whitelistIds[total - 1]).toBe(String(200000 + total - 1));
		expect(result.whitelistCount).toBe(total);
		vi.unstubAllGlobals();
	});
});

describe("accountIdentityToStored", () => {
	it("数字 ID 存裸数字", () => {
		expect(accountIdentityToStored({ id: "123" })).toBe("123");
	});

	it("handle 存 @ 前缀", () => {
		expect(accountIdentityToStored({ handle: "foo" })).toBe("@foo");
	});

	it("id 优先于 handle", () => {
		expect(accountIdentityToStored({ id: "123", handle: "foo" })).toBe("123");
	});

	it("没有合法 id/handle 时返回 null", () => {
		expect(accountIdentityToStored({})).toBeNull();
		expect(accountIdentityToStored({ handle: "@" })).toBeNull();
	});
});

describe("addAccountToList", () => {
	it("追加合法的 @handle 和数字 ID", () => {
		expect(addAccountToList([], "@foo")).toEqual(["@foo"]);
		expect(addAccountToList(["@foo"], "123")).toEqual(["@foo", "123"]);
	});

	it("已存在（大小写 / @ 前缀差异）时返回 null", () => {
		expect(addAccountToList(["@Foo"], "@foo")).toBeNull();
		expect(addAccountToList(["123"], "123")).toBeNull();
		expect(addAccountToList(["@foo"], "@FOO")).toBeNull();
	});

	it("非法 entry 返回 null", () => {
		expect(addAccountToList([], "@")).toBeNull();
		expect(
			addAccountToList([], "not a valid @ handle with spaces!"),
		).toBeNull();
	});
});
