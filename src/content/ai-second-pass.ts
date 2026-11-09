/**
 * The experimental Jev second pass: replies no local rule matched are batched
 * and sent to the user's own model endpoint through the worker.
 *
 * Everything here is opt-in and budgeted. The invariants that matter:
 *  - never ask for a verdict on text the user whitelisted or that a rule hit;
 *  - one paid request per debounce window, capped per page session;
 *  - a verdict is remembered by text fingerprint, so a re-render never re-asks;
 *  - a verdict that arrives after a rule change is discarded.
 *
 * The queue, the session cache and the in-flight flag used to be module-level
 * state in the content script. Here they are per-instance, which is also what
 * makes the budget and de-duplication rules testable.
 */

import type { FilterReason } from "@/src/content/filter-reason";
import type { AiCandidate, AiEvaluateResponse } from "@/src/contracts/ai";
import {
	AI_MAX_BATCH,
	aiFingerprint,
	shouldFilter,
} from "@/src/domain/ai-filter";

/** Marker for a hit that came from Jev rather than from a local rule. */
export const AI_HIT = "ai:noise";
/** Let the local pass settle before spending the user's money on a request. */
export const AI_DEBOUNCE_MS = 500;
/** Session cap on remembered verdicts; the durable cache lives in the worker. */
const AI_RESOLVED_LIMIT = 4000;
/**
 * Hard ceiling on the requests one page may spend before it stops queueing.
 * The worker caps the rate; this caps the total for a single stretch of
 * browsing, so an endlessly scrolling timeline cannot run up a bill.
 */
export const AI_SESSION_MAX_REQUESTS = 200;

export interface AiSecondPassOptions {
	/** True once the extension context is invalidated. */
	isDead(): boolean;
	/** True while filtering is active on this page and the user enabled it. */
	isActive(): boolean;
	/** Post under discussion, used as context for status pages. */
	readParentText(): string;
	/** Current rule generation, to discard verdicts made stale mid-flight. */
	getGeneration(): number;
	/** Send the batch through the background worker. */
	send(message: unknown): Promise<AiEvaluateResponse | null>;
	/** Paint a verdict using the same pipeline as a local rule hit. */
	applyVerdict(article: Element, probability: number): void;
	/** Structured debug log. */
	log(
		event: string,
		details: Record<string, unknown>,
		level?: "info" | "warn",
	): void;
	/** Cached hit marker for verdicts, so presentation stays uniform. */
	verdictHit: string;
	/** Optional scheduler override, defaults to setTimeout (tests drive it). */
	setTimer?(callback: () => void, ms: number): TimerHandle;
	clearTimer?(timer: TimerHandle): void;
}

/** setTimeout's return type differs between DOM and Node; keep both working. */
export type TimerHandle = ReturnType<typeof setTimeout>;

export interface AiSecondPass {
	/** Offer a reply to the second pass. */
	queue(article: Element, text: string): void;
	/** Flush pending replies now (the debounce callback). */
	flush(): Promise<void>;
	/** Drop all pending state; call on stop/teardown. */
	clear(): void;
	/** Tests only: how many paid requests this page has spent. */
	readonly requestsSpent: number;
}

export function createAiSecondPass(options: AiSecondPassOptions): AiSecondPass {
	/** Replies waiting for a verdict, keyed by element so re-renders replace rows. */
	const queue = new Map<
		Element,
		{ key: string; author: string; text: string }
	>();
	/** Verdicts seen this session, so a rescan never re-asks for the same text. */
	const resolved = new Map<string, number>();
	let timer: TimerHandle | 0 = 0;
	let inFlight = false;
	let requestSequence = 0;
	let requestsSpent = 0;

	const setTimer =
		options.setTimer ??
		((cb: () => void, ms: number): TimerHandle => setTimeout(cb, ms));
	const clearTimer =
		options.clearTimer ?? ((id: TimerHandle) => clearTimeout(id));

	function remember(key: string, probability: number): void {
		resolved.set(key, probability);
		if (resolved.size <= AI_RESOLVED_LIMIT) return;
		const oldest = resolved.keys().next().value;
		if (oldest !== undefined) resolved.delete(oldest);
	}

	function schedule(): void {
		if (timer) return;
		timer = setTimer(() => {
			timer = 0;
			void flush();
		}, AI_DEBOUNCE_MS);
	}

	function queueReply(article: Element, text: string): void {
		if (options.isDead() || !text.trim()) return;
		const key = aiFingerprint(text);
		const known = resolved.get(key);
		// A re-rendered reply still gets the verdict we already paid for.
		if (known !== undefined) {
			if (shouldFilter(known)) options.applyVerdict(article, known);
			return;
		}
		const author = "";
		queue.set(article, { key, author, text });
		schedule();
	}

	async function flush(): Promise<void> {
		if (options.isDead() || inFlight) return;
		if (!options.isActive()) {
			queue.clear();
			return;
		}

		if (requestsSpent >= AI_SESSION_MAX_REQUESTS) {
			queue.clear();
			options.log(
				"ai.budget",
				{ spent: requestsSpent, limit: AI_SESSION_MAX_REQUESTS },
				"warn",
			);
			return;
		}

		const batch: { el: Element; key: string; item: AiCandidate }[] = [];
		for (const [el, entry] of queue) {
			queue.delete(el);
			if (!el.isConnected) continue;
			if (batch.length >= AI_MAX_BATCH) {
				queue.set(el, entry);
				continue;
			}
			batch.push({
				el,
				key: entry.key,
				item: {
					id: `r${++requestSequence}`,
					author: entry.author,
					text: entry.text,
				},
			});
		}
		if (!batch.length) return;
		requestsSpent++;

		const generationAtRequest = options.getGeneration();
		inFlight = true;
		try {
			const response = await options.send({
				type: "BLUENOISE_AI_EVALUATE",
				parent: options.readParentText(),
				items: batch.map((entry) => entry.item),
			});
			if (!response) return;
			if (!response.ok) {
				options.log(
					"ai.failed",
					{ error: response.error ?? "unknown" },
					"warn",
				);
				return;
			}
			let filtered = 0;
			for (const entry of batch) {
				const probability = response.probabilities?.[entry.item.id];
				if (typeof probability !== "number") continue;
				remember(entry.key, probability);
				if (!shouldFilter(probability)) continue;
				// A config or rule change mid-flight invalidates the whole verdict.
				if (options.getGeneration() !== generationAtRequest) continue;
				if (!entry.el.isConnected) continue;
				options.applyVerdict(entry.el, probability);
				filtered++;
			}
			options.log("ai.batch", { requested: batch.length, filtered });
		} finally {
			inFlight = false;
			if (options.isDead()) queue.clear();
			else if (queue.size) schedule();
		}
	}

	function clear(): void {
		if (timer) clearTimer(timer);
		timer = 0;
		queue.clear();
		resolved.clear();
		requestsSpent = 0;
	}

	return {
		queue: queueReply,
		flush,
		clear,
		get requestsSpent() {
			return requestsSpent;
		},
	};
}

/** Reason object for a verdict hit, kept here so presentation stays uniform. */
export function aiVerdictReason(probability: number): FilterReason {
	return { category: "ai", probability };
}
