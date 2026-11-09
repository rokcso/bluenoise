import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { KeywordSubscription } from "@/src/contracts/config";
import { buildMatchers, matchDetail } from "@/src/domain/matcher";
import { parseKeywordText } from "@/src/domain/normalize";

/**
 * Golden corpus regression for the built-in keyword list.
 *
 * The list in `data/keywords.txt` is the product's core promise: it either
 * catches spam or it does not, and every trimmed or added phrase moves both
 * numbers. This suite pins the behaviour of every case so a rule change has to
 * justify itself in review instead of silently trading precision for recall.
 *
 * Run with `CORPUS_REPORT=1` to rewrite `metrics.json`; commit that file with
 * the rule change and the diff shows the precision/recall movement.
 */

interface CorpusCase {
	id: string;
	text: string;
	expected: "spam" | "clean";
	note?: string;
	/** A flip we have decided to accept; counted separately, never hidden. */
	known_limitation?: boolean;
}

interface Corpus {
	corpus_version: number;
	description: string;
	cases: CorpusCase[];
}

const corpus = JSON.parse(
	readFileSync(new URL("./corpus/cases.json", import.meta.url), "utf8"),
) as Corpus;

const metricsPath = new URL("./corpus/metrics.json", import.meta.url);

/** The list BlueNoise ships, exactly as the extension loads it. */
const builtinKeywords = parseKeywordText(
	readFileSync(new URL("../data/keywords.txt", import.meta.url), "utf8"),
);

function shippedMatchers() {
	const subscription: KeywordSubscription = {
		id: "bluenoise",
		name: "BlueNoise",
		homepageUrl: "https://github.com/rokcso/bluenoise",
		url: "",
		enabled: true,
		keywords: builtinKeywords,
		syncedAt: 0,
	};
	// The default settings a new install uses: case-insensitive, whitespace
	// and full-width variants folded together.
	return buildMatchers({
		caseSensitive: false,
		ignoreSpaces: true,
		subscriptions: [subscription],
		userKeywords: [],
		whitelist: [],
	});
}

interface Tally {
	tp: number;
	fp: number;
	fn: number;
	tn: number;
	known_limitation: number;
}

function classify(): { outcomes: Map<string, string | null>; tally: Tally } {
	const matchers = shippedMatchers();
	const outcomes = new Map<string, string | null>();
	const tally: Tally = { tp: 0, fp: 0, fn: 0, tn: 0, known_limitation: 0 };

	for (const item of corpus.cases) {
		const match = matchDetail(matchers, item.text);
		const hit = match ? match.hit : null;
		outcomes.set(item.id, hit);

		const caught = hit !== null;
		const shouldCatch = item.expected === "spam";
		if (item.known_limitation) {
			tally.known_limitation++;
			continue;
		}
		if (caught && shouldCatch) tally.tp++;
		else if (caught && !shouldCatch) tally.fp++;
		else if (!caught && shouldCatch) tally.fn++;
		else tally.tn++;
	}

	return { outcomes, tally };
}

const scored = corpus.cases.filter((item) => !item.known_limitation);

describe("keyword corpus", () => {
	it("has a version and no duplicate ids", () => {
		expect(corpus.corpus_version).toBeGreaterThan(0);
		const ids = new Set(corpus.cases.map((item) => item.id));
		expect(ids.size).toBe(corpus.cases.length);
	});

	it("loads a non-empty built-in list", () => {
		expect(builtinKeywords.length).toBeGreaterThan(100);
	});

	it("catches every spam case in the corpus", () => {
		const { outcomes } = classify();
		const missed = scored
			.filter(
				(item) => item.expected === "spam" && outcomes.get(item.id) === null,
			)
			.map((item) => item.id);

		expect(missed).toEqual([]);
	});

	it("never flags a clean case", () => {
		const { outcomes } = classify();
		const falsePositives = scored
			.filter(
				(item) => item.expected === "clean" && outcomes.get(item.id) !== null,
			)
			.map((item) => `${item.id} (matched "${outcomes.get(item.id)}")`);

		expect(falsePositives).toEqual([]);
	});

	it("keeps every case on its recorded verdict", () => {
		// One snapshot per case, so a new rule that re-covers an old case with a
		// different keyword is still visible in review.
		const { outcomes } = classify();
		expect(Object.fromEntries(outcomes)).toMatchSnapshot();
	});

	it("reports precision and recall", () => {
		const { tally } = classify();
		const precision = tally.tp / Math.max(1, tally.tp + tally.fp);
		const recall = tally.tp / Math.max(1, tally.tp + tally.fn);
		const accuracy = (tally.tp + tally.tn) / Math.max(1, scored.length);

		if (process.env.CORPUS_REPORT === "1") {
			writeFileSync(
				metricsPath,
				`${JSON.stringify(
					{
						corpus_version: corpus.corpus_version,
						builtin_rule_count: builtinKeywords.length,
						cases: corpus.cases.length,
						scored: scored.length,
						...tally,
						precision: Number(precision.toFixed(4)),
						recall: Number(recall.toFixed(4)),
						accuracy: Number(accuracy.toFixed(4)),
					},
					null,
					"\t",
				)}\n`,
			);
		}

		// A floor, not a target: these exist so a careless list edit cannot turn
		// the shipped rules into a blunt instrument.
		expect(precision).toBeGreaterThanOrEqual(0.95);
		expect(recall).toBeGreaterThanOrEqual(0.8);
		expect(tally.fp).toBe(0);
	});
});
