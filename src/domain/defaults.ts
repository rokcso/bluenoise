import type { AppConfig, RuleData } from "@/src/contracts/config";

export const DEFAULTS: AppConfig = {
	theme: "auto",
	language: "auto",
	enabled: true,
	mode: "dim",
	revealOnHover: true,
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
	hideTitleCount: true,
	hideNotificationBadges: true,
	hideNewPostsPrompt: true,
	hideGrokButton: true,
	hideMessageButton: true,
	keywordSourceEnabled: { "x-spam-filter": true, community: true },
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
	accountListEnabled: true,
	externalAccountListsEnabled: false,
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
	};
}
