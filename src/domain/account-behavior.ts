/**
 * Reply-farm detector: rules over an account's own recent posting behavior.
 *
 * Why this exists: the strongest evidence against these accounts is not what one
 * reply says, but that the account posted it 14 seconds after the previous one,
 * to a different stranger, for the eighth time this minute. A human cannot read,
 * think and type that fast; a scheduler can.
 *
 * Every rule here is deterministic and cheap, so it never spends tokens and never
 * needs a model. The score is built from independent signals and gated below 1,
 * because no single signal is proof on its own — a busy human can look bursty,
 * but a busy human does not also reuse one opening line across unrelated threads.
 */

import {
	BEHAVIOR_MAX_REPLIES,
	BEHAVIOR_TTL_MS,
	type BehaviorHistory,
	type ReplyRecord,
	TIMELINE_PARENT,
} from "@/src/contracts/behavior";

/** Score at or above which the account's reply is treated as farm output. */
export const BEHAVIOR_THRESHOLD = 0.7;

/** B1: a burst of replies spread across different strangers. */
export const BURST_WINDOW_MS = 60_000;
export const BURST_MIN_REPLIES = 4;
/** Different threads is the part that separates a farm from a chatty human. */
export const BURST_MIN_PARENTS = 3;
const BURST_WEIGHT = 0.45;

/** B2: sustained volume over a longer window. */
export const FLOOD_WINDOW_MS = 10 * 60_000;
export const FLOOD_MIN_REPLIES = 10;
const FLOOD_WEIGHT = 0.3;

/** B3: the gaps between consecutive replies are too short to type them. */
export const CADENCE_MIN_SAMPLES = 4;
export const CADENCE_MEDIAN_MS = 20_000;
const CADENCE_WEIGHT = 0.25;

/** B4: a machine-regular cadence — a scheduler, not a person. */
export const REGULAR_MIN_GAPS = 5;
export const REGULAR_MAX_CV = 0.15;
const REGULAR_WEIGHT = 0.25;

/** B5: posting through the small hours without a break. */
export const NIGHT_START_HOUR = 0;
export const NIGHT_END_HOUR = 4;
export const NIGHT_MIN_REPLIES = 5;
export const NIGHT_WINDOW_MS = 15 * 60_000;
const NIGHT_WEIGHT = 0.1;

/** C1: one opening phrase reused across unrelated threads. */
export const OPENING_MIN_USES = 3;
export const OPENING_MIN_PARENTS = 2;
const OPENING_WEIGHT = 0.3;

/** C4: a longer phrase lifted verbatim into several replies. */
export const PHRASE_GRAM = 8;
export const PHRASE_MIN_OTHERS = 2;
const PHRASE_WEIGHT = 0.2;

/** C3: text that stops exactly at the platform's length ceiling. */
export const TRUNCATION_MIN_WEIGHTED = 270;
/** X weighs CJK characters as two, so its 280 ceiling is ~140 CJK characters. */
const CJK_LIMIT_WEIGHT = 2;
const CJK_RE =
	/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const SENTENCE_END_RE = /[.!?。！？…」』”"')）]$/;
const TRUNCATION_WEIGHT = 0.1;

export type BehaviorSignalId =
	| "burst"
	| "flood"
	| "cadence"
	| "regular"
	| "night"
	| "opening"
	| "phrase"
	| "truncated";

export interface BehaviorSignal {
	id: BehaviorSignalId;
	weight: number;
}

export interface BehaviorVerdict {
	score: number;
	signals: BehaviorSignal[];
	/** Replies considered for this account. */
	replies: number;
	/** Window the strongest signal looked at, in seconds. */
	windowSeconds: number;
	/** Median gap between consecutive replies, in seconds, when measurable. */
	medianGapSeconds?: number;
}

/** Length as X counts it: CJK characters consume two positions. */
export function weightedLength(text: string): number {
	let total = 0;
	for (const char of text) total += CJK_RE.test(char) ? CJK_LIMIT_WEIGHT : 1;
	return total;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] ?? 0)
		: ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function gapsOf(records: ReplyRecord[]): number[] {
	const gaps: number[] = [];
	for (let i = 1; i < records.length; i++) {
		const gap = (records[i]?.at ?? 0) - (records[i - 1]?.at ?? 0);
		if (gap > 0) gaps.push(gap);
	}
	return gaps;
}

/** Coefficient of variation: how irregular the cadence is. */
function coefficientOfVariation(values: number[]): number | null {
	if (values.length < 2) return null;
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	if (mean <= 0) return null;
	const variance =
		values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance) / mean;
}

/**
 * The phrase a reply opens with, normalized enough that punctuation and emoji
 * do not split it: the first four CJK characters, or the first word otherwise.
 */
export function openingKey(text: string): string | null {
	const match = text
		.replace(/^[\s\p{P}\p{S}\p{Emoji_Presentation}]+/u, "")
		.trim();
	if (!match) return null;
	if (CJK_RE.test(match[0] ?? "")) {
		const key = [...match].slice(0, 4).join("").replace(/\s+/g, "");
		return key.length >= 2 ? key : null;
	}
	const word = match.match(/^[\p{L}\p{N}']+/u)?.[0] ?? "";
	return word.length >= 3 ? word.toLowerCase() : null;
}

function grams(text: string, size: number): Set<string> {
	const normalized = text.toLowerCase().replace(/\s+/g, " ");
	const chars = [...normalized];
	const out = new Set<string>();
	for (let i = 0; i + size <= chars.length; i++) {
		out.add(chars.slice(i, i + size).join(""));
	}
	return out;
}

/** Shared 8-char phrases between the newest reply and the account's other replies. */
function phraseReuseCount(records: ReplyRecord[]): number {
	const latest = records.at(-1);
	if (!latest) return 0;
	const latestGrams = grams(latest.text, PHRASE_GRAM);
	if (!latestGrams.size) return 0;
	let others = 0;
	for (const record of records.slice(0, -1)) {
		const shared = grams(record.text, PHRASE_GRAM);
		for (const gram of latestGrams) {
			if (shared.has(gram)) {
				others++;
				break;
			}
		}
	}
	return others;
}

/** How many times the newest reply's opening phrase appears in this account's history. */
function openingReuse(records: ReplyRecord[]): {
	uses: number;
	parents: number;
} | null {
	const latest = records.at(-1);
	const key = latest ? openingKey(latest.text) : null;
	if (!key) return null;
	const matching = records.filter((record) => openingKey(record.text) === key);
	return {
		uses: matching.length,
		parents: new Set(matching.map((record) => record.parent)).size,
	};
}

/**
 * Score one account's reply given everything seen for it so far. `records` must
 * be ordered oldest to newest and already include the reply being judged.
 */
export function evaluateBehavior(
	records: ReplyRecord[],
): BehaviorVerdict | null {
	const latest = records.at(-1);
	if (!latest) return null;

	const signals: BehaviorSignal[] = [];
	const now = latest.at;
	const recent = records.filter((record) => now - record.at <= FLOOD_WINDOW_MS);
	const within = (ms: number) =>
		records.filter((record) => now - record.at <= ms);

	// B1 — burst across different threads.
	const burst = within(BURST_WINDOW_MS);
	const burstParents = new Set(
		burst
			.map((record) => record.parent)
			.filter((parent) => parent !== TIMELINE_PARENT),
	);
	if (
		burst.length >= BURST_MIN_REPLIES &&
		burstParents.size >= BURST_MIN_PARENTS
	) {
		signals.push({ id: "burst", weight: BURST_WEIGHT });
	}

	// B2 — sustained volume.
	if (recent.length >= FLOOD_MIN_REPLIES) {
		signals.push({ id: "flood", weight: FLOOD_WEIGHT });
	}

	// B3 — gaps too short to have read the post, thought, and typed.
	const gaps = gapsOf(recent);
	const medianGap = gaps.length ? median(gaps) : null;
	if (gaps.length + 1 >= CADENCE_MIN_SAMPLES && medianGap !== null) {
		if (medianGap <= CADENCE_MEDIAN_MS) {
			signals.push({ id: "cadence", weight: CADENCE_WEIGHT });
		}
	}

	// B4 — cadence regular enough to be a scheduler.
	const cv = coefficientOfVariation(gaps);
	if (gaps.length >= REGULAR_MIN_GAPS && cv !== null && cv <= REGULAR_MAX_CV) {
		signals.push({ id: "regular", weight: REGULAR_WEIGHT });
	}

	// B5 — still posting at 3am local time, without a break.
	const hour = new Date(now).getHours();
	if (
		hour >= NIGHT_START_HOUR &&
		hour < NIGHT_END_HOUR &&
		within(NIGHT_WINDOW_MS).length >= NIGHT_MIN_REPLIES
	) {
		signals.push({ id: "night", weight: NIGHT_WEIGHT });
	}

	// C1 — the same opening line across unrelated threads.
	const opening = openingReuse(records);
	if (
		opening &&
		opening.uses >= OPENING_MIN_USES &&
		opening.parents >= OPENING_MIN_PARENTS
	) {
		signals.push({ id: "opening", weight: OPENING_WEIGHT });
	}

	// C4 — a longer phrase carried verbatim into several replies.
	if (phraseReuseCount(records) >= PHRASE_MIN_OTHERS) {
		signals.push({ id: "phrase", weight: PHRASE_WEIGHT });
	}

	// C3 — text that ends exactly at the ceiling, mid-sentence.
	if (
		weightedLength(latest.text) >= TRUNCATION_MIN_WEIGHTED &&
		!SENTENCE_END_RE.test(latest.text.trim())
	) {
		signals.push({ id: "truncated", weight: TRUNCATION_WEIGHT });
	}

	const score = Math.min(
		1,
		signals.reduce((sum, signal) => sum + signal.weight, 0),
	);
	return {
		score,
		signals,
		replies: recent.length,
		windowSeconds: Math.round(FLOOD_WINDOW_MS / 1000),
		...(medianGap !== null
			? { medianGapSeconds: Math.max(1, Math.round(medianGap / 1000)) }
			: {}),
	};
}

/** Whether the verdict is strong enough to act on. */
export function shouldFilterBehavior(verdict: BehaviorVerdict | null): boolean {
	return Boolean(verdict && verdict.score >= BEHAVIOR_THRESHOLD);
}

/**
 * Append a reply to an account's history. The same thread root id is stored by
 * reference so a reply that is re-rendered is not counted twice.
 */
export function recordReply(
	history: BehaviorHistory,
	handle: string,
	record: ReplyRecord,
): BehaviorHistory {
	const key = handle.toLowerCase();
	const existing = history[key] ?? [];
	// A re-rendered reply reuses its post time; drop the stale copy first.
	const without = existing.filter((entry) => entry.at !== record.at);
	const entries = [...without, record]
		.filter((entry) => record.at - entry.at <= BEHAVIOR_TTL_MS)
		.sort((a, b) => a.at - b.at)
		.slice(-BEHAVIOR_MAX_REPLIES);
	return { ...history, [key]: entries };
}
