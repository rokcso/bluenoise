import { describe, expect, it } from "vitest";
import {
	type DebugLogEntry,
	debugLogToJsonl,
	isDebugLogEntry,
	trimDebugLog,
} from "@/src/contracts/debug-log";

function entry(
	id: string,
	details: Record<string, unknown> = {},
): DebugLogEntry {
	return {
		id,
		timestamp: 1,
		sessionId: "session",
		level: "info",
		event: "scan.completed",
		context: { path: "/home" },
		details,
	};
}

describe("debug log storage", () => {
	it("keeps the newest entries within the count limit", () => {
		expect(trimDebugLog([entry("1"), entry("2"), entry("3")], 2)).toEqual([
			entry("2"),
			entry("3"),
		]);
	});

	it("keeps the newest complete entries within the byte limit", () => {
		const newest = entry("new", { text: "small" });
		const maxBytes = new TextEncoder().encode(
			JSON.stringify([newest]),
		).byteLength;
		expect(
			trimDebugLog(
				[entry("old", { text: "x".repeat(500) }), newest],
				10,
				maxBytes,
			),
		).toEqual([newest]);
	});

	it("serializes one JSON object per line", () => {
		const entries = [entry("1"), entry("2")];
		expect(debugLogToJsonl(entries).split("\n").map(JSON.parse)).toEqual(
			entries,
		);
	});

	it("rejects malformed messages", () => {
		expect(isDebugLogEntry(entry("valid"))).toBe(true);
		expect(isDebugLogEntry({ event: "missing metadata" })).toBe(false);
	});
});
