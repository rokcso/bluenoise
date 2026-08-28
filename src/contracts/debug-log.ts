export const DEBUG_LOG_KEY = "debug-log-v1";
export const DEBUG_LOG_MAX_ENTRIES = 500;
export const DEBUG_LOG_MAX_BYTES = 512 * 1024;
export const DEBUG_LOG_FLUSH_DELAY_MS = 300;

export type DebugLogLevel = "debug" | "info" | "warn" | "error";

export interface DebugLogEntry {
	id: string;
	timestamp: number;
	sessionId: string;
	level: DebugLogLevel;
	event: string;
	context: {
		path: string;
	};
	details: Record<string, unknown>;
}

export function isDebugLogEntry(value: unknown): value is DebugLogEntry {
	if (!value || typeof value !== "object") return false;
	const entry = value as Partial<DebugLogEntry>;
	return (
		typeof entry.id === "string" &&
		typeof entry.timestamp === "number" &&
		Number.isFinite(entry.timestamp) &&
		typeof entry.sessionId === "string" &&
		["debug", "info", "warn", "error"].includes(entry.level ?? "") &&
		typeof entry.event === "string" &&
		Boolean(entry.context) &&
		typeof entry.context?.path === "string" &&
		Boolean(entry.details) &&
		typeof entry.details === "object"
	);
}

function encodedSize(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Keep the newest entries within both the count and serialized-size limits. */
export function trimDebugLog(
	entries: DebugLogEntry[],
	maxEntries = DEBUG_LOG_MAX_ENTRIES,
	maxBytes = DEBUG_LOG_MAX_BYTES,
): DebugLogEntry[] {
	const kept: DebugLogEntry[] = [];
	let bytes = 2;
	for (let index = entries.length - 1; index >= 0; index--) {
		if (kept.length >= maxEntries) break;
		const entry = entries[index];
		const entryBytes = encodedSize(entry) + (kept.length ? 1 : 0);
		if (bytes + entryBytes > maxBytes) break;
		kept.push(entry);
		bytes += entryBytes;
	}
	return kept.reverse();
}

export function debugLogToJsonl(entries: DebugLogEntry[]): string {
	return entries.map((entry) => JSON.stringify(entry)).join("\n");
}
