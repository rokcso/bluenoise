import type { AppConfig, RuleData } from "@/src/contracts/config";

/** Default opacity of filtered content in "dim" mode. */
export const DEFAULT_DIM_OPACITY = 0.05;
/** Lower bound keeps filtered content perceivable (0 would read as "hide"). */
export const MIN_DIM_OPACITY = 0.05;
export const MAX_DIM_OPACITY = 1;

function clampDimOpacity(value: unknown): number {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric)) return DEFAULT_DIM_OPACITY;
	return Math.min(MAX_DIM_OPACITY, Math.max(MIN_DIM_OPACITY, numeric));
}

export const DEFAULTS: AppConfig = {
	theme: "auto",
	language: "auto",
	enabled: true,
	pageCleanupEnabled: false,
	mode: "dim",
	dimOpacity: DEFAULT_DIM_OPACITY,
	revealOnHover: true,
	showFilterReason: true,
	showBadgeCount: true,
	showActualReplyCount: false,
	collapseSidebar: false,
	hidePremiumPromo: false,
	hidePremiumFeaturePrompt: false,
	hideFooter: false,
	useBlueBird: false,
	hideTrends: false,
	hideFollowSuggestions: false,
	hideTimelineFollowSuggestions: false,
	hideDiscoverMore: false,
	hideLiveStreams: false,
	hideSportsScores: false,
	hideTitleCount: false,
	hideNotificationBadges: false,
	hideNewPostsPrompt: false,
	hideGrokButton: false,
	hideMessageButton: false,
	keywordSourceEnabled: {
		bluenoise: true,
		"x-spam-filter": false,
		"x-comment-blocker": false,
	},
	matchNames: false,
	ignoreSpaces: true,
	caseSensitive: false,
	debugLogging: false,
	aiFilterEnabled: false,
	filterMediaAds: false,
	filterCardAds: false,
	filterParodyAccounts: false,
	filterFanAccounts: false,
	filterCommentaryAccounts: false,
	filterAutomatedAccounts: false,
	accountSourceEnabled: { bluenoise: true, mxga: false },
};

export const DEFAULT_RULE_DATA: RuleData = {
	keywords: { user: { block: [], allow: [] }, external: {} },
	accounts: { user: { allow: [], block: [] }, external: {} },
};

export function defaultConfig(): AppConfig {
	return { ...DEFAULTS };
}

export function defaultRuleData(): RuleData {
	return structuredClone(DEFAULT_RULE_DATA);
}

/** Merge a partial (e.g. stored) object over the defaults. */
export function loadConfig(partial: unknown): AppConfig {
	const stored = (partial ?? {}) as Partial<AppConfig>;
	return {
		...DEFAULTS,
		...stored,
		dimOpacity: clampDimOpacity(stored.dimOpacity),
		keywordSourceEnabled: {
			...DEFAULTS.keywordSourceEnabled,
			...stored.keywordSourceEnabled,
		},
		accountSourceEnabled: {
			...DEFAULTS.accountSourceEnabled,
			...stored.accountSourceEnabled,
		},
	};
}
