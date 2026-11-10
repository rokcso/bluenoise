/**
 * Per-tweet evaluation and its cache.
 *
 * `evaluate()` used to be a 120-line function inside the content-script entry
 * point, entangled with module-level mutable state, so the only way to test a
 * filtering rule was to load the whole extension. This module keeps the same
 * behaviour but takes everything it needs through `options`, which makes the
 * interesting cases (main-tweet exemption, cache reuse, preset changes, the
 * Jev hand-off) testable against a plain DOM.
 *
 * Two caches exist and they answer different questions:
 *  - `canReuseFastEvaluation` (evaluation-cache.ts) is the cheap "nothing that
 *    could matter changed" test, before paying for a TreeWalker pass;
 *  - the per-article signature below catches the rest, including rule and
 *    account-list version bumps.
 */

import {
	classifyArticle,
	type FilteredLog,
} from "@/src/content/article-classifier";
import type { ArticlePreset } from "@/src/content/evaluation-cache";
import { canReuseFastEvaluation } from "@/src/content/evaluation-cache";
import type { FilterReason } from "@/src/content/filter-reason";
import { isCardAd, isMediaAd } from "@/src/content/promoted";
import {
	isAutomatedAccount,
	isCommentaryAccount,
	isFanAccount,
	isParodyAccount,
	readAuthorIdentity,
	readAuthorName,
	readTweetText,
} from "@/src/content/selectors";
import type { AppConfig, Matchers, RuleView } from "@/src/contracts/config";
import type { AccountListIndex } from "@/src/domain/account-list";

/** Separator between signature fields; must not appear in tweet text. */
const SEP = "\u001f";

/** What an evaluation concluded about one article. */
export interface EvaluationOutcome {
	/** False when the cached result was reused. */
	fresh: boolean;
	/** Structured entry for the debug log, only when logging is on. */
	log: FilteredLog | null;
	/** Why this article ended up (or did not end up) filtered. */
	outcome:
		| "cache-hit"
		| "filtered"
		| "main-tweet"
		| "no-active-rules"
		| "no-match";
}

interface CachedEvaluation {
	sig: string;
	preset?: ArticlePreset;
	hit: string | null;
	reason: FilterReason | null;
	log: FilteredLog | null;
}

export interface ArticleEvaluator {
	/** Classify one article, reusing the previous result when nothing changed. */
	evaluate(article: Element): EvaluationOutcome;
	/** The mark currently cached for an article, without re-evaluating it. */
	cachedMark(
		article: Element,
	): { hit: string | null; reason: FilterReason | null } | null;
	/** Forget a single cached article (used when its row is detached). */
	forget(article: Element): void;
	/** Mark an article's text/name subtree as changed since the last pass. */
	markTextDirty(article: Element): void;
	/** Mark an article's preset markers as changed since the last pass. */
	markStructureDirty(article: Element): void;
	/**
	 * Apply a verdict that came from outside the rule engine (Jev) to an already
	 * cached article. Returns false when there is nothing to update.
	 *
	 * The cached signature is preserved deliberately: rewriting it would make the
	 * next scan treat the article as stale, re-evaluate it, and queue it again —
	 * an endless loop of paid requests.
	 */
	applyExternalHit(
		article: Element,
		hit: string,
		reason: FilterReason,
	): boolean;
}

export interface ArticleEvaluatorOptions {
	getConfig(): AppConfig;
	getMatchers(): Matchers;
	getRuleView(): RuleView;
	/** Active community account lists, already indexed. */
	getAccountSourceIndexes(): { id: string; index: AccountListIndex }[];
	/** Display names for the active account sources, for debug logs. */
	accountSourceNames: ReadonlyMap<string, string>;
	/** Bumped on any rule/config change so cached verdicts are invalidated. */
	getGeneration(): number;
	/** Version of the merged account-list snapshot. */
	getAccountListVersion(): number;
	/** Truthy when this article is the post that was opened. */
	isMainTweet(article: Element): boolean;
	/** Paint the result onto the DOM. */
	applyMark(
		article: Element,
		hit: string | null,
		reason: FilterReason | null,
	): void;
	/** Hand an unmatched reply to the Jev second pass. */
	queueForAi?(article: Element, text: string, name: string): void;
	/**
	 * Record the reply for the behavior source and return a verdict when the
	 * account looks automated. Called for every reply, including the ones that
	 * pass: the timing of unfiltered replies is the evidence.
	 */
	judgeBehavior?(input: {
		article: Element;
		text: string;
		/** Author handle, or "" when it could not be read. */
		handle: string;
	}): { hit: string; reason: FilterReason } | null;
}

/** Preset filters that are enabled for this config, in precedence order. */
export function readPresetFilter(
	article: Element,
	cfg: Pick<
		AppConfig,
		| "filterMediaAds"
		| "filterCardAds"
		| "filterParodyAccounts"
		| "filterFanAccounts"
		| "filterCommentaryAccounts"
		| "filterAutomatedAccounts"
	>,
): ArticlePreset | undefined {
	let preset: ArticlePreset | undefined;
	if (
		(cfg.filterMediaAds && isMediaAd(article)) ||
		(cfg.filterCardAds && isCardAd(article))
	)
		preset = "ad";
	if (cfg.filterParodyAccounts && isParodyAccount(article)) preset = "parody";
	if (cfg.filterFanAccounts && isFanAccount(article)) preset = "fan";
	if (cfg.filterCommentaryAccounts && isCommentaryAccount(article))
		preset = "commentary";
	if (cfg.filterAutomatedAccounts && isAutomatedAccount(article))
		preset = "automated";
	return preset;
}

export function createArticleEvaluator(
	options: ArticleEvaluatorOptions,
): ArticleEvaluator {
	const state = new WeakMap<Element, CachedEvaluation>();
	/** Articles whose text/name subtree changed since the last evaluation. */
	const textDirty = new WeakSet<Element>();
	/** Articles whose preset markers changed since the last evaluation. */
	const structureDirty = new WeakSet<Element>();

	function markTextDirty(article: Element): void {
		textDirty.add(article);
	}

	function markStructureDirty(article: Element): void {
		structureDirty.add(article);
	}

	function evaluate(article: Element): EvaluationOutcome {
		const cfg = options.getConfig();
		const ruleView = options.getRuleView();
		const matchers = options.getMatchers();
		const generation = options.getGeneration();
		const accountListVersion = options.getAccountListVersion();

		// X can add promotion/account labels after the article is first rendered.
		// Include this cheap structural state in the cache key so those changes
		// cannot reuse an earlier non-advertisement result.
		const preset = readPresetFilter(article, cfg);
		const cached = state.get(article);
		// Most mutations X emits are layout or accessibility updates. If the rule
		// generation is unchanged and neither matching subtree is dirty, avoid the
		// expensive TreeWalker pass entirely.
		if (
			cached &&
			canReuseFastEvaluation({
				cachedSignature: cached.sig,
				cachedPreset: cached.preset,
				currentPreset: preset,
				textDirty: textDirty.has(article),
				structureDirty: structureDirty.has(article),
				generation,
				accountListVersion,
				separator: SEP,
			})
		) {
			options.applyMark(article, cached.hit, cached.reason);
			return { fresh: false, log: null, outcome: "cache-hit" };
		}
		textDirty.delete(article);
		structureDirty.delete(article);
		const text = readTweetText(article);
		const name = cfg.matchNames ? readAuthorName(article) : "";
		const sig = [generation, accountListVersion, preset ?? "", text, name].join(
			SEP,
		);

		if (cached && cached.sig === sig) {
			options.applyMark(article, cached.hit, cached.reason);
			return { fresh: false, log: null, outcome: "cache-hit" };
		}

		// Account matching needs the numeric user id (React internals); keyword
		// matching only needs the @handle from the DOM.
		const externalAccountSourcesActive = Object.values(
			cfg.accountSourceEnabled,
		).some(Boolean);
		const accountListsActive =
			externalAccountSourcesActive ||
			ruleView.accountWhitelist.length > 0 ||
			ruleView.accountBlacklist.length > 0;

		const decision = { hit: null, reason: null, log: null } as {
			hit: string | null;
			reason: FilterReason | null;
			log: FilteredLog | null;
			whitelisted?: boolean;
		};
		const mainTweet = options.isMainTweet(article);
		const hasActiveRules =
			matchers.count > 0 ||
			accountListsActive ||
			cfg.filterMediaAds ||
			cfg.filterCardAds ||
			cfg.filterParodyAccounts ||
			cfg.filterFanAccounts ||
			cfg.filterCommentaryAccounts ||
			cfg.filterAutomatedAccounts;

		if (!mainTweet && hasActiveRules) {
			Object.assign(
				decision,
				classifyArticle(
					{
						body: text,
						name,
						identity: preset
							? cfg.debugLogging
								? readAuthorIdentity(article, false)
								: {}
							: readAuthorIdentity(article, accountListsActive),
						preset,
					},
					{
						matchers,
						accountSources: externalAccountSourcesActive
							? options.getAccountSourceIndexes()
							: [],
						accountWhitelist: ruleView.accountWhitelist,
						accountBlacklist: ruleView.accountBlacklist,
						accountSourceNames: options.accountSourceNames,
						debugLogging: cfg.debugLogging,
					},
				),
			);
		}

		// The behavior source runs last: it needs the reply's text and author, and
		// it must not override a local rule hit or a whitelist decision, both of
		// which are explicit statements from the user.
		let finalDecision = decision;
		if (
			options.judgeBehavior &&
			!mainTweet &&
			!decision.hit &&
			!decision.whitelisted
		) {
			const verdict = options.judgeBehavior({
				article,
				text,
				// Cheap: the name subtree is already parsed for matching above.
				handle: readAuthorIdentity(article, false).handle ?? "",
			});
			if (verdict)
				finalDecision = {
					...decision,
					hit: verdict.hit,
					reason: verdict.reason,
				};
		}

		state.set(article, { sig, preset, ...finalDecision });
		options.applyMark(article, finalDecision.hit, finalDecision.reason);
		// Jev only ever sees replies that no local rule matched, and never one the
		// user explicitly whitelisted. It is a second opinion, not a replacement
		// for the keyword and account lists.
		if (
			cfg.aiFilterEnabled &&
			!mainTweet &&
			!finalDecision.hit &&
			!decision.whitelisted
		)
			options.queueForAi?.(article, text, name);

		return {
			fresh: true,
			log: decision.log,
			outcome: mainTweet
				? "main-tweet"
				: !hasActiveRules
					? "no-active-rules"
					: finalDecision.hit
						? "filtered"
						: "no-match",
		};
	}

	function cachedMark(
		article: Element,
	): { hit: string | null; reason: FilterReason | null } | null {
		const cached = state.get(article);
		return cached ? { hit: cached.hit, reason: cached.reason } : null;
	}

	function forget(article: Element): void {
		state.delete(article);
	}

	function applyExternalHit(
		article: Element,
		hit: string,
		reason: FilterReason,
	): boolean {
		const cached = state.get(article);
		if (!cached || cached.hit) return false;
		state.set(article, { ...cached, hit, reason, log: null });
		options.applyMark(article, hit, reason);
		return true;
	}

	return {
		evaluate,
		cachedMark,
		forget,
		markTextDirty,
		markStructureDirty,
		applyExternalHit,
	};
}
