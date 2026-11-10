/**
 * Content-side glue for the behavior source.
 *
 * Every reply the extension evaluates is recorded here, including the ones that
 * pass, because the timing of the replies that *were not* filtered is exactly the
 * evidence. The history is written back lazily: a timeline that renders fifty
 * replies in a second should not cause fifty storage writes.
 *
 * Failure to persist is not fatal. The in-memory history still answers for this
 * page session, so the source degrades to "one page of evidence" rather than
 * switching off.
 */

import {
	BEHAVIOR_HISTORY_KEY,
	type BehaviorHistory,
	capBehaviorHistory,
	parseBehaviorHistory,
	TIMELINE_PARENT,
} from "@/src/contracts/behavior";
import {
	type BehaviorVerdict,
	evaluateBehavior,
	recordReply,
	shouldFilterBehavior,
} from "@/src/domain/account-behavior";

/** Coalesce writes while a timeline is rendering. */
export const BEHAVIOR_WRITE_DELAY_MS = 2000;

export interface BehaviorSourceOptions {
	/** Read the persisted history once, at startup. */
	load(): Promise<unknown>;
	/** Persist the whole map; called at most once per write delay. */
	save(history: BehaviorHistory): Promise<void>;
	/** Local diagnostic log. */
	log(event: string, details: Record<string, unknown>): void;
	/** Optional timer override, for tests. */
	setTimer?(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
	clearTimer?(timer: ReturnType<typeof setTimeout>): void;
}

export interface BehaviorInput {
	/** Author handle, without the leading @. */
	handle: string;
	/** Post time in epoch milliseconds, decoded from the status id. */
	at: number;
	/** Thread the reply belongs to, or `null` outside a thread. */
	parent: string | null;
	text: string;
}

export interface BehaviorSource {
	/** Hydrate from storage; safe to call more than once. */
	ready(): Promise<void>;
	/** Record one reply and return a verdict when the account looks automated. */
	judge(input: BehaviorInput): BehaviorVerdict | null;
	/** Flush any pending write (page teardown, tests). */
	flush(): Promise<void>;
}

export function createBehaviorSource(
	options: BehaviorSourceOptions,
): BehaviorSource {
	let history: BehaviorHistory = {};
	let hydrated: Promise<void> | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
	const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));

	function scheduleSave(): void {
		if (timer) return;
		timer = setTimer(() => {
			timer = null;
			void options.save(capBehaviorHistory(history)).catch((error) => {
				options.log("behavior.persist-failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
		}, BEHAVIOR_WRITE_DELAY_MS);
	}

	async function ready(): Promise<void> {
		hydrated ??= options
			.load()
			.then((stored) => {
				history = parseBehaviorHistory(stored);
			})
			.catch((error) => {
				options.log("behavior.load-failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
		return hydrated;
	}

	function judge(input: BehaviorInput): BehaviorVerdict | null {
		const handle = input.handle.trim().replace(/^@/, "").toLowerCase();
		if (!handle || !Number.isFinite(input.at) || input.at <= 0) return null;

		history = recordReply(history, handle, {
			at: input.at,
			parent: input.parent ?? TIMELINE_PARENT,
			text: input.text,
		});
		scheduleSave();

		const verdict = evaluateBehavior(history[handle] ?? []);
		if (!verdict || !shouldFilterBehavior(verdict)) return null;
		options.log("behavior.hit", {
			handle,
			score: Math.round(verdict.score * 100) / 100,
			signals: verdict.signals.map((signal) => signal.id),
		});
		return verdict;
	}

	async function flush(): Promise<void> {
		if (!timer) return;
		clearTimer(timer);
		timer = null;
		await options.save(capBehaviorHistory(history));
	}

	return { ready, judge, flush };
}

/** Storage key re-exported so the entry point does not import two modules. */
export { BEHAVIOR_HISTORY_KEY };
