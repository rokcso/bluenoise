// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
	AI_DEBOUNCE_MS,
	AI_HIT,
	AI_SESSION_MAX_REQUESTS,
	createAiSecondPass,
} from "@/src/content/ai-second-pass";
import { shouldFilter } from "@/src/domain/ai-filter";
import { installChromeMock } from "./helpers/chrome-mock";

function renderReply(text: string): Element {
	const article = document.createElement("article");
	article.dataset.testid = "tweet";
	const body = document.createElement("div");
	body.dataset.testid = "tweetText";
	body.textContent = text;
	article.append(body);
	document.body.append(article);
	return article;
}

interface HarnessOptions {
	active?: boolean;
	/** Probability the fake model returns for every item. */
	probability?: number;
	/** Answer only these text bodies, leaving the rest without a verdict. */
	answers?: Record<string, number>;
	fail?: boolean;
	/** Runs while the request is in flight, to simulate a mid-flight edit. */
	duringRequest?: () => void;
}

function harness(options: HarnessOptions = {}) {
	const verdicts: { article: Element; probability: number }[] = [];
	const sends: unknown[] = [];
	let dead = false;
	let generation = 1;
	let _timerCallback: (() => void) | null = null;

	const pass = createAiSecondPass({
		isDead: () => dead,
		isActive: () => options.active ?? true,
		readParentText: () => "",
		getGeneration: () => generation,
		send: async (message) => {
			sends.push(message);
			options.duringRequest?.();
			if (options.fail) return { ok: false, error: "boom" };
			const items = (message as { items: { id: string; text: string }[] })
				.items;
			const probabilities: Record<string, number> = {};
			for (const item of items) {
				const answer = options.answers?.[item.text];
				if (answer !== undefined) probabilities[item.id] = answer;
				else if (options.probability !== undefined)
					probabilities[item.id] = options.probability;
			}
			return { ok: true, probabilities };
		},
		applyVerdict: (article, probability) => {
			verdicts.push({ article, probability });
		},
		log: () => {},
		verdictHit: AI_HIT,
		// The debounce is driven by the test, not by wall-clock time.
		setTimer: (callback) => {
			_timerCallback = callback;
			return 1 as unknown as ReturnType<typeof setTimeout>;
		},
		clearTimer: () => {
			_timerCallback = null;
		},
	});

	return {
		pass,
		verdicts,
		sends,
		/**
		 * Run the batch now. The debounce itself is exercised by the "one request
		 * per window" test; everything else wants the flush synchronously.
		 */
		async settle() {
			await pass.flush();
		},
		kill() {
			dead = true;
		},
		bumpGeneration() {
			generation++;
		},
	};
}

describe("Jev second pass", () => {
	beforeEach(() => {
		installChromeMock({ uiLanguage: "en" });
		document.body.innerHTML = "";
	});

	it("applies a verdict that crosses the noise threshold", async () => {
		const h = harness({ probability: 0.95 });
		const reply = renderReply("这是一段很规整的回复");

		h.pass.queue(reply, "这是一段很规整的回复");
		await h.settle();

		expect(shouldFilter(0.95)).toBe(true);
		expect(h.verdicts).toHaveLength(1);
		expect(h.verdicts[0].article).toBe(reply);
	});

	it("does not mark a reply the model considers human", async () => {
		const h = harness({ probability: 0.1 });
		const reply = renderReply("我自己的看法，可能不太对");

		h.pass.queue(reply, "我自己的看法，可能不太对");
		await h.settle();

		expect(shouldFilter(0.1)).toBe(false);
		expect(h.verdicts).toHaveLength(0);
	});

	it("never asks twice for the same text", async () => {
		const h = harness({ probability: 0.95 });
		const first = renderReply("同样的一段话");
		const second = renderReply("同样的一段话");

		h.pass.queue(first, "同样的一段话");
		await h.settle();
		const requestsAfterFirst = h.sends.length;

		// X re-renders rows constantly; the second sighting must be free.
		h.pass.queue(second, "同样的一段话");
		await h.settle();

		expect(requestsAfterFirst).toBe(1);
		expect(h.sends).toHaveLength(1);
		// But the cached verdict still gets painted on the new element.
		expect(h.verdicts.at(-1)?.article).toBe(second);
	});

	it("batches replies queued in the same debounce window", async () => {
		const h = harness({ probability: 0.95 });
		const a = renderReply("第一条");
		const b = renderReply("第二条");

		h.pass.queue(a, "第一条");
		h.pass.queue(b, "第二条");
		await h.settle();

		const message = h.sends[0] as { items: { text: string }[] };
		expect(message.items.map((item) => item.text)).toEqual([
			"第一条",
			"第二条",
		]);
	});

	it("stops spending once the session cap is reached", async () => {
		const h = harness({ probability: 0.1 });
		for (let index = 0; index < AI_SESSION_MAX_REQUESTS + 5; index++) {
			const reply = renderReply(`回复 ${index}`);
			h.pass.queue(reply, `回复 ${index}`);
			await h.settle();
		}

		expect(h.pass.requestsSpent).toBe(AI_SESSION_MAX_REQUESTS);
		expect(h.sends).toHaveLength(AI_SESSION_MAX_REQUESTS);
	});

	it("drops the queue when filtering is no longer active", async () => {
		const h = harness({ active: false, probability: 0.95 });
		const reply = renderReply("待判定");

		h.pass.queue(reply, "待判定");
		await h.settle();

		expect(h.sends).toHaveLength(0);
	});

	it("discards a verdict that arrives after the rules changed", async () => {
		let h: ReturnType<typeof harness>;
		h = harness({
			probability: 0.95,
			// A rule edit lands while the request is already in flight; by the time
			// the answer comes back the article belongs to a different generation.
			duringRequest: () => h.bumpGeneration(),
		});
		const reply = renderReply("规则中途变了");

		h.pass.queue(reply, "规则中途变了");
		await h.settle();

		expect(h.sends).toHaveLength(1);
		expect(h.verdicts).toHaveLength(0);
	});

	it("queues nothing after the extension context died", async () => {
		const h = harness({ probability: 0.95 });
		const reply = renderReply("上下文已经失效");
		h.kill();

		h.pass.queue(reply, "上下文已经失效");
		await h.settle();

		expect(h.sends).toHaveLength(0);
	});

	it("does not queue blank text", async () => {
		const h = harness({ probability: 0.95 });
		const reply = renderReply("   ");

		h.pass.queue(reply, "   ");
		await h.settle();

		expect(h.sends).toHaveLength(0);
	});

	it("uses a debounce so a burst becomes one request", () => {
		expect(AI_DEBOUNCE_MS).toBeGreaterThan(0);
		expect(AI_DEBOUNCE_MS).toBeLessThan(5000);
	});

	it("forgets spent budget and cached verdicts when cleared", async () => {
		const h = harness({ probability: 0.95 });
		const reply = renderReply("会被清掉");
		h.pass.queue(reply, "会被清掉");
		await h.settle();
		expect(h.pass.requestsSpent).toBe(1);

		h.pass.clear();

		expect(h.pass.requestsSpent).toBe(0);
		const again = renderReply("会被清掉");
		h.pass.queue(again, "会被清掉");
		await h.settle();
		// The session cache was cleared, so this text is paid for again.
		expect(h.sends).toHaveLength(2);
	});
});
