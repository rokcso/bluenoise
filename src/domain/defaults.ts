import type { AppConfig } from "@/src/contracts/config";

export const DEFAULTS: AppConfig = {
	theme: "auto",
	language: "auto",
	enabled: true,
	mode: "dim",
	revealOnHover: true,
	showBadgeCount: true,
	hidePremiumPromo: false,
	hideFooter: false,
	subscriptions: [
		{
			id: "x-spam-filter",
			name: "X Spam Filter",
			homepageUrl: "https://github.com/ZPVIP/x-spam-filter",
			url: "https://raw.githubusercontent.com/ZPVIP/x-spam-filter/main/keywords.txt",
			enabled: true,
			keywords: null,
			syncedAt: 0,
		},
		{
			id: "community",
			name: "X Comment Blocker",
			homepageUrl: "https://github.com/amahteru/x-comment-blocker",
			url: "https://raw.githubusercontent.com/amahteru/x-comment-blocker/refs/heads/main/keywords.txt",
			enabled: true,
			keywords: null,
			syncedAt: 0,
		},
	],
	userKeywords: [],
	whitelist: [],
	matchNames: false,
	ignoreSpaces: true,
	caseSensitive: false,
	debugLogging: false,
	accountListEnabled: true,
	externalAccountListsEnabled: false,
	accountWhitelist: [],
	accountBlacklist: [],
};

export function defaultConfig(): AppConfig {
	return { ...DEFAULTS };
}

/** Merge a partial (e.g. stored) object over the defaults. */
export function loadConfig(partial: unknown): AppConfig {
	const stored = (partial ?? {}) as Partial<AppConfig>;
	const subscriptions = (stored.subscriptions ?? DEFAULTS.subscriptions).map(
		(subscription) => {
			const defaults = DEFAULTS.subscriptions.find(
				(item) => item.id === subscription.id,
			);
			return {
				...defaults,
				...subscription,
				// Source metadata is maintained by the extension, not user-configurable.
				name: defaults?.name ?? subscription.name,
				homepageUrl:
					defaults?.homepageUrl ?? subscription.homepageUrl ?? subscription.url,
				url: defaults?.url ?? subscription.url,
			};
		},
	);
	return { ...DEFAULTS, ...stored, subscriptions };
}
