/**
 * Account-level blacklist/whitelist sync and matching.
 *
 * Following MXGA's own extension, the full public blacklist is fetched as the
 * compact "lite" artifact (schema v2, ~9 MB raw / ~4 MB on the wire) — not the
 * multi-hundred-MB shards. The background service worker downloads it once and
 * caches it in storage.local; content scripts read that cache and hot-swap via
 * storage.onChanged. Matching keeps the compact strings only (no per-entry
 * object expansion), so a tab's resident set is small.
 */
export const MXGA_META_URL = "https://x.zuoluo.tv/v1/list/meta";
export const MXGA_BASE_URL = "https://x.zuoluo.tv";
export const MXGA_WHITELIST_URL = `${MXGA_BASE_URL}/v1/whitelist`;
/** Public data / audit-history viewer, used as a settings link. */
export const MXGA_DATA_URL = "https://x.zuoluo.tv/list";
export const MXGA_REPO_URL = "https://github.com/foru17/make-x-great-again";

export interface AccountListSource {
	id: string;
	name: string;
	homepageUrl?: string;
	blacklistUrl: string;
	/** MXGA uses separate JSON artifacts; simple sources use one text file. */
	format?: "mxga-json" | "one-per-line";
	whitelistUrl?: string;
	metaUrl?: string;
	artifactBaseUrl?: string;
}

export const DEFAULT_ACCOUNT_LIST_SOURCES: AccountListSource[] = [
	{
		id: "bluenoise",
		name: "BlueNoise",
		homepageUrl:
			"https://github.com/rokcso/bluenoise/blob/main/data/accounts.txt",
		blacklistUrl:
			"https://raw.githubusercontent.com/rokcso/bluenoise/refs/heads/main/data/accounts.txt",
		format: "one-per-line",
	},
	{
		id: "mxga",
		name: "Make X Great Again",
		homepageUrl: MXGA_REPO_URL,
		blacklistUrl: `${MXGA_BASE_URL}/v1/artifacts/lite.json`,
		whitelistUrl: MXGA_WHITELIST_URL,
		metaUrl: MXGA_META_URL,
		artifactBaseUrl: MXGA_BASE_URL,
	},
];

export interface AccountListSnapshot {
	version: number;
	blacklistIds: string[];
	blacklistHandles: string[];
	whitelistIds: string[];
	whitelistHandles: string[];
	blacklistCount: number;
	whitelistCount: number;
	syncedAt: number;
	syncError?: string;
	sources?: string[];
}

export interface AccountIdentity {
	id?: string;
	handle?: string;
}

/** Compact in-memory membership index: only strings, no expanded objects. */
export interface AccountListIndex {
	whitelistIds: Set<string>;
	whitelistHandles: Set<string>;
	blacklistIds: Set<string>;
	blacklistHandles: Set<string>;
}

export interface AccountMatchSource {
	id: string;
	index: AccountListIndex;
}

export interface AccountMatchResult {
	decision: "whitelist" | "blacklist";
	source: "user" | string;
}

// ----- Remote payload validation limits (mirror MXGA's own guardrails) -----

/** The published blacklist must not silently shrink below this on a sync. */
const MIN_SANE_ENTRIES = 1000;
/** Cap on total blacklist rows, protects against a corrupted giant artifact. */
const MAX_LIST_ENTRIES = 250_000;
/** A malformed row in a fresh artifact may be quarantined up to this many. */
const MAX_DROPPED_ENTRY_ROWS = 100;
/** Bounded read caps (decompressed bytes). */
const MAX_META_BYTES = 64 * 1024;
const MAX_WHITELIST_BYTES = 2 * 1024 * 1024;
const MAX_LITE_BYTES = 25 * 1024 * 1024;

const ARTIFACT_PATH_RE = /^\/v1\/artifacts\/[A-Za-z0-9._-]+$/;

export function normalizeAccountHandle(handle: string | undefined): string {
	return (handle ?? "").trim().replace(/^@/, "").toLowerCase();
}

export function normalizeAccountEntry(value: string): string | null {
	const entry = value.trim();
	if (/^\d+$/.test(entry)) return entry;
	const handle = normalizeAccountHandle(entry);
	return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

/**
 * Turn an account identity into the form stored in the local lists:
 * a bare numeric id, or an @-prefixed handle. Returns null when the
 * identity carries neither a valid id nor a valid handle.
 */
export function accountIdentityToStored(
	identity: AccountIdentity,
): string | null {
	const entry = normalizeAccountEntry(identity.id ?? identity.handle ?? "");
	if (!entry) return null;
	return /^\d+$/.test(entry) ? entry : `@${entry}`;
}

/**
 * Append `stored` (already in stored form: "123" or "@handle") to a local
 * account list, deduplicating against entries that normalize to the same
 * account. Returns the new array, or null when the entry is invalid or
 * already present (no-op).
 */
export function addAccountToList(
	list: string[],
	stored: string,
): string[] | null {
	const entry = normalizeAccountEntry(stored);
	if (!entry) return null;
	if (list.some((item) => normalizeAccountEntry(item) === entry)) return null;
	return [...list, stored];
}

/** Parse a human-maintained TXT list: one numeric id or @handle per line. */
export function parseAccountText(text: string): {
	ids: string[];
	handles: string[];
} {
	const ids = new Set<string>();
	const handles = new Set<string>();
	for (const rawLine of String(text || "").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const entry = normalizeAccountEntry(line);
		if (!entry) continue;
		if (/^\d+$/.test(entry)) ids.add(entry);
		else handles.add(entry);
	}
	return { ids: [...ids], handles: [...handles] };
}

function matchesEntries(entries: string[], identity: AccountIdentity): boolean {
	const id = identity.id;
	const handle = normalizeAccountHandle(identity.handle);
	return entries.some((entry) => {
		const normalized = normalizeAccountEntry(entry);
		return normalized !== null && (normalized === id || normalized === handle);
	});
}

/** Parse the untrusted lite artifact. Strict by default; the sync path can
 *  quarantine a bounded number of malformed rows so one stale server record
 *  does not block an otherwise-valid list update. */
function parseLite(
	value: unknown,
	options: { dropInvalidEntries?: boolean } = {},
): { ids: string[]; handles: string[]; version: number } {
	const payload = value as {
		schema?: number;
		generatedAt?: number;
		entries?: unknown;
	};
	if (payload.schema !== 2 || !Array.isArray(payload.entries))
		throw new Error("Invalid account blacklist");
	if (payload.entries.length > MAX_LIST_ENTRIES)
		throw new Error("Account blacklist too large");
	const ids: string[] = [];
	const handles: string[] = [];
	let dropped = 0;
	for (const entry of payload.entries) {
		const valid =
			Array.isArray(entry) &&
			entry.length >= 3 &&
			typeof entry[0] === "string" &&
			typeof entry[1] === "string";
		if (!valid) {
			if (!options.dropInvalidEntries) throw new Error("Invalid account entry");
			if (++dropped > MAX_DROPPED_ENTRY_ROWS)
				throw new Error("Too many invalid account entries");
			continue;
		}
		const [id, handle] = entry as [string, string];
		if (/^\d+$/.test(id)) ids.push(id);
		if (handle) handles.push(normalizeAccountHandle(handle));
	}
	// Refuse to overwrite a good cache with an implausibly tiny artifact.
	if (ids.length + handles.length < MIN_SANE_ENTRIES)
		throw new Error("Implausibly small account list");
	return {
		ids,
		handles,
		version: Number(payload.generatedAt) || Date.now(),
	};
}

/** Parse the whitelist artifact: { list: [{ x_user_id, handle }] }. */
function parseWhitelist(value: unknown): { ids: string[]; handles: string[] } {
	const payload = value as {
		list?: unknown;
	};
	if (!Array.isArray(payload.list))
		throw new Error("Invalid account whitelist");
	const ids: string[] = [];
	const handles: string[] = [];
	for (const entry of payload.list) {
		if (typeof entry?.x_user_id === "string" && /^\d+$/.test(entry.x_user_id))
			ids.push(entry.x_user_id);
		if (typeof entry?.handle === "string" && entry.handle)
			handles.push(normalizeAccountHandle(entry.handle));
	}
	return { ids, handles };
}

/** MXGA's /v1/whitelist is paginated (`since` = last_scored cursor, up to
 *  `limit` rows per page). Without following the cursor the external whitelist
 *  silently shrinks to the first page (~500 rows), so accounts on the real
 *  whitelist get over-hidden. Follow the cursor until it stops advancing. */
const WHITELIST_PAGE_SIZE = 2000;
const WHITELIST_MAX_PAGES = 20;

async function fetchWhitelist(
	source: AccountListSource,
): Promise<{ ids: string[]; handles: string[] }> {
	if (!source.whitelistUrl)
		throw new Error(`Missing whitelist URL for ${source.id}`);
	const rows: unknown[] = [];
	let since = 0;
	for (let page = 0; page < WHITELIST_MAX_PAGES; page++) {
		const sep = source.whitelistUrl.includes("?") ? "&" : "?";
		const url = `${source.whitelistUrl}${sep}limit=${WHITELIST_PAGE_SIZE}&since=${since}`;
		const payload = (await fetchJsonBounded(url, MAX_WHITELIST_BYTES)) as {
			list?: unknown;
			latestAt?: number;
		};
		const list = Array.isArray(payload.list) ? payload.list : [];
		if (list.length === 0) break;
		rows.push(...list);
		const latestAt = Number(payload.latestAt) || 0;
		if (latestAt <= since) break; // cursor not advancing → no more pages
		since = latestAt;
	}
	return parseWhitelist({ list: rows });
}

/** Buffer only bounded JSON responses; decompressed bytes count toward the cap. */
async function fetchJsonBounded(
	url: string,
	maxBytes: number,
): Promise<unknown> {
	const response = await fetch(url, { cache: "no-store" });
	if (!response.ok)
		throw new Error(`Account list request failed: HTTP ${response.status}`);
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > maxBytes)
		throw new Error("Account list response too large");
	if (!response.body) {
		const text = await response.text();
		if (new TextEncoder().encode(text).byteLength > maxBytes)
			throw new Error("Account list response too large");
		return JSON.parse(text);
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let size = 0;
	let text = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) {
				await reader.cancel();
				throw new Error("Account list response too large");
			}
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
		return JSON.parse(text);
	} finally {
		reader.releaseLock();
	}
}

async function fetchTextBounded(
	url: string,
	maxBytes: number,
): Promise<string> {
	const response = await fetch(url, { cache: "no-store" });
	if (!response.ok)
		throw new Error(`Account list request failed: HTTP ${response.status}`);
	const text = await response.text();
	if (new TextEncoder().encode(text).byteLength > maxBytes)
		throw new Error("Account list response too large");
	if (/^\s*<(?:!doctype|html)\b/i.test(text))
		throw new Error("Account list source returned HTML");
	return text;
}

export async function syncAccountListSource(
	source: AccountListSource,
	previous?: AccountListSnapshot,
): Promise<AccountListSnapshot> {
	if (source.format === "one-per-line") {
		const black = parseAccountText(
			await fetchTextBounded(source.blacklistUrl, MAX_WHITELIST_BYTES),
		);
		return {
			version: Date.now(),
			blacklistIds: black.ids,
			blacklistHandles: black.handles,
			whitelistIds: [],
			whitelistHandles: [],
			blacklistCount: black.ids.length + black.handles.length,
			whitelistCount: 0,
			syncedAt: Date.now(),
			sources: [source.id],
		};
	}
	if (!source.whitelistUrl)
		throw new Error(`Missing whitelist URL for ${source.id}`);
	// Meta-driven source: fetch the compact lite artifact for the blacklist and
	// the tiny whitelist. When the published version is unchanged, reuse the
	// stored blacklist and only refresh the whitelist — no re-download.
	if (source.metaUrl && source.artifactBaseUrl) {
		const meta = (await fetchJsonBounded(source.metaUrl, MAX_META_BYTES)) as {
			version?: string;
			artifacts?: { lite?: string };
		};
		const version = Number(
			(meta.version ?? "").match(/(\d+)$/)?.[1] ?? Date.now(),
		);
		const litePath = meta.artifacts?.lite;
		if (!litePath || !ARTIFACT_PATH_RE.test(litePath))
			throw new Error(`Invalid account list metadata from ${source.id}`);

		const unchanged =
			!!previous &&
			previous.sources?.includes(source.id) &&
			version === previous.version &&
			previous.blacklistIds.length > 0 &&
			previous.blacklistHandles.length > 0;
		if (unchanged) {
			const white = await fetchWhitelist(source);
			return {
				version,
				blacklistIds: previous.blacklistIds,
				blacklistHandles: previous.blacklistHandles,
				whitelistIds: white.ids,
				whitelistHandles: white.handles,
				blacklistCount: previous.blacklistCount,
				whitelistCount: white.ids.length,
				syncedAt: Date.now(),
				sources: [source.id],
			};
		}

		const liteUrl = new URL(litePath, source.artifactBaseUrl).toString();
		const [black, white] = await Promise.all([
			fetchJsonBounded(liteUrl, MAX_LITE_BYTES).then((value) =>
				parseLite(value, { dropInvalidEntries: true }),
			),
			fetchWhitelist(source),
		]);
		return {
			version,
			blacklistIds: black.ids,
			blacklistHandles: black.handles,
			whitelistIds: white.ids,
			whitelistHandles: white.handles,
			blacklistCount: black.ids.length,
			whitelistCount: white.ids.length,
			syncedAt: Date.now(),
			sources: [source.id],
		};
	}

	// Non-meta fallback: the source directly serves lite + whitelist JSON.
	const [black, white] = await Promise.all([
		fetchJsonBounded(source.blacklistUrl, MAX_LITE_BYTES).then((value) =>
			parseLite(value, { dropInvalidEntries: true }),
		),
		fetchWhitelist(source),
	]);
	return {
		version: black.version,
		blacklistIds: black.ids,
		blacklistHandles: black.handles,
		whitelistIds: white.ids,
		whitelistHandles: white.handles,
		blacklistCount: black.ids.length,
		whitelistCount: white.ids.length,
		syncedAt: Date.now(),
		sources: [source.id],
	};
}

/** Merge independent sources into one local snapshot; allowlist wins globally. */
export async function syncAccountLists(
	sources: AccountListSource[] = DEFAULT_ACCOUNT_LIST_SOURCES,
	previous?: AccountListSnapshot,
): Promise<AccountListSnapshot> {
	if (sources.length === 0)
		throw new Error("At least one account list source is required");
	const results = await Promise.allSettled(
		sources.map((source) => syncAccountListSource(source, previous)),
	);
	const snapshots = results
		.filter(
			(result): result is PromiseFulfilledResult<AccountListSnapshot> =>
				result.status === "fulfilled",
		)
		.map((result) => result.value);
	if (snapshots.length === 0) {
		const reason = results.find(
			(result) => result.status === "rejected",
		)?.reason;
		throw reason instanceof Error
			? reason
			: new Error(String(reason ?? "All account list sources failed"));
	}
	const failedSources = results
		.map((result, index) =>
			result.status === "rejected" ? sources[index]?.id : null,
		)
		.filter((id): id is string => Boolean(id));
	return {
		version: Math.max(...snapshots.map((item) => item.version)),
		blacklistIds: [...new Set(snapshots.flatMap((item) => item.blacklistIds))],
		blacklistHandles: [
			...new Set(snapshots.flatMap((item) => item.blacklistHandles)),
		],
		whitelistIds: [...new Set(snapshots.flatMap((item) => item.whitelistIds))],
		whitelistHandles: [
			...new Set(snapshots.flatMap((item) => item.whitelistHandles)),
		],
		blacklistCount: snapshots.reduce(
			(total, item) => total + item.blacklistCount,
			0,
		),
		whitelistCount: snapshots.reduce(
			(total, item) => total + item.whitelistCount,
			0,
		),
		syncedAt: Date.now(),
		sources: snapshots.flatMap((item) => item.sources ?? []),
		...(failedSources.length > 0
			? { syncError: `Failed sources: ${failedSources.join(", ")}` }
			: {}),
	};
}

export function matchAccount(
	snapshot: AccountListSnapshot | undefined,
	identity: AccountIdentity,
): "whitelist" | "blacklist" | null {
	if (!snapshot) return null;
	return matchAccountIndex(
		snapshot ? buildAccountListIndex(snapshot) : undefined,
		identity,
	);
}

export function buildAccountListIndex(
	snapshot: AccountListSnapshot,
): AccountListIndex {
	return {
		whitelistIds: new Set(snapshot.whitelistIds),
		whitelistHandles: new Set(snapshot.whitelistHandles),
		blacklistIds: new Set(snapshot.blacklistIds),
		blacklistHandles: new Set(snapshot.blacklistHandles),
	};
}

/** Merge selected provider snapshots into the indexable account-list shape. */
export function mergeAccountListSnapshots(
	snapshots: AccountListSnapshot[],
): AccountListSnapshot | undefined {
	if (snapshots.length === 0) return undefined;
	return {
		version: Math.max(...snapshots.map((item) => item.version)),
		blacklistIds: [...new Set(snapshots.flatMap((item) => item.blacklistIds))],
		blacklistHandles: [
			...new Set(snapshots.flatMap((item) => item.blacklistHandles)),
		],
		whitelistIds: [...new Set(snapshots.flatMap((item) => item.whitelistIds))],
		whitelistHandles: [
			...new Set(snapshots.flatMap((item) => item.whitelistHandles)),
		],
		blacklistCount: snapshots.reduce(
			(sum, item) => sum + item.blacklistCount,
			0,
		),
		whitelistCount: snapshots.reduce(
			(sum, item) => sum + item.whitelistCount,
			0,
		),
		syncedAt: Math.max(...snapshots.map((item) => item.syncedAt)),
		sources: snapshots.flatMap((item) => item.sources ?? []),
	};
}

export function matchAccountIndex(
	index: AccountListIndex | undefined,
	identity: AccountIdentity,
	localWhitelist: string[] = [],
	localBlacklist: string[] = [],
): "whitelist" | "blacklist" | null {
	return (
		matchAccountSources(
			index ? [{ id: "external", index }] : [],
			identity,
			localWhitelist,
			localBlacklist,
		)?.decision ?? null
	);
}

/** Match with the same precedence as matchAccountIndex while retaining provenance. */
export function matchAccountSources(
	sources: AccountMatchSource[],
	identity: AccountIdentity,
	localWhitelist: string[] = [],
	localBlacklist: string[] = [],
): AccountMatchResult | null {
	// Local rules always win over external ones: local whitelist, then local
	// blacklist, then external whitelist, then external blacklist.
	if (matchesEntries(localWhitelist, identity))
		return { decision: "whitelist", source: "user" };
	if (matchesEntries(localBlacklist, identity))
		return { decision: "blacklist", source: "user" };
	const id = identity.id;
	const handle = normalizeAccountHandle(identity.handle);
	for (const source of sources) {
		if (
			(id && source.index.whitelistIds.has(id)) ||
			(handle && source.index.whitelistHandles.has(handle))
		)
			return { decision: "whitelist", source: source.id };
	}
	for (const source of sources) {
		if (
			(id && source.index.blacklistIds.has(id)) ||
			(handle && source.index.blacklistHandles.has(handle))
		)
			return { decision: "blacklist", source: source.id };
	}
	return null;
}
