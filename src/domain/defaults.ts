import type { AppConfig, RuleData } from "@/src/contracts/config";

export const DEFAULTS: AppConfig = {
	theme: "auto",
	language: "auto",
	enabled: true,
	pageCleanupEnabled: false,
	mode: "dim",
	revealOnHover: true,
	showFilterReason: true,
	showBadgeCount: true,
	showActualReplyCount: false,
	collapseSidebar: false,
	hidePremiumPromo: false,
	hideFooter: false,
	useBlueBird: false,
	hideTrends: false,
	hideFollowSuggestions: false,
	hideTimelineFollowSuggestions: false,
	hideDiscoverMore: false,
	hideLiveStreams: false,
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
	filterAds: false,
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
