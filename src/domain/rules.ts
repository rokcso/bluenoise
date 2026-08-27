import type {
	AppConfig,
	KeywordSubscription,
	RuleData,
	RuleView,
} from "@/src/contracts/config";
import {
	type AccountIdentity,
	accountIdentityToStored,
	addAccountToList,
} from "@/src/domain/account-list";

export const KEYWORD_SOURCES: Omit<
	KeywordSubscription,
	"enabled" | "keywords" | "syncedAt" | "etag" | "syncError"
>[] = [
	{
		id: "bluenoise",
		name: "BlueNoise",
		homepageUrl: "https://github.com/rokcso/bluenoise",
		url: "https://raw.githubusercontent.com/rokcso/bluenoise/refs/heads/main/data/keywords.txt",
		allowEmpty: true,
	},
	{
		id: "x-spam-filter",
		name: "X Spam Filter",
		homepageUrl: "https://github.com/ZPVIP/x-spam-filter",
		url: "https://raw.githubusercontent.com/ZPVIP/x-spam-filter/main/keywords.txt",
	},
	{
		id: "community",
		name: "X Comment Blocker",
		homepageUrl: "https://github.com/amahteru/x-comment-blocker",
		url: "https://raw.githubusercontent.com/amahteru/x-comment-blocker/refs/heads/main/keywords.txt",
	},
];

export function loadRuleData(value: unknown): RuleData {
	const data = value as Partial<RuleData> | undefined;
	return {
		keywords: {
			user: {
				block: data?.keywords?.user?.block ?? [],
				allow: data?.keywords?.user?.allow ?? [],
			},
			external: data?.keywords?.external ?? {},
		},
		accounts: {
			user: {
				allow: data?.accounts?.user?.allow ?? [],
				block: data?.accounts?.user?.block ?? [],
			},
			external: data?.accounts?.external ?? {},
		},
	};
}

export function addAccountRule(
	rules: RuleData,
	list: "allow" | "block",
	identity: AccountIdentity,
): RuleData | null {
	const stored = accountIdentityToStored(identity);
	if (!stored) return null;
	const next = addAccountToList(rules.accounts.user[list], stored);
	if (!next) return null;
	return {
		...rules,
		accounts: {
			...rules.accounts,
			user: { ...rules.accounts.user, [list]: next },
		},
	};
}

export function createRuleView(settings: AppConfig, rules: RuleData): RuleView {
	return {
		keywordSourceEnabled: settings.keywordSourceEnabled,
		userKeywords: rules.keywords.user.block,
		whitelist: rules.keywords.user.allow,
		accountWhitelist: rules.accounts.user.allow,
		accountBlacklist: rules.accounts.user.block,
		subscriptions: KEYWORD_SOURCES.map((source) => ({
			...source,
			enabled: settings.keywordSourceEnabled[source.id] ?? false,
			keywords: rules.keywords.external[source.id]?.keywords ?? null,
			syncedAt: rules.keywords.external[source.id]?.syncedAt ?? 0,
			etag: rules.keywords.external[source.id]?.etag,
			syncError: rules.keywords.external[source.id]?.syncError,
		})),
	};
}
