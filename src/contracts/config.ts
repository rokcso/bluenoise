/**
 * Behavioral settings stored in chrome.storage.sync under "settings".
 */
export interface AppConfig {
	/** "auto" follows the OS color scheme; "light"/"dark" force one. Popup-only. */
	theme: "auto" | "light" | "dark";
	/** UI language. "auto" follows Chrome's display language. */
	language: "auto" | "en" | "zh_CN";
	/** Master switch: turning it off instantly restores all replies. */
	enabled: boolean;
	/** Master switch for X's own interface cleanup, independent of content filtering. */
	pageCleanupEnabled: boolean;
	/** "dim" = fade the whole reply; "hide" = make it disappear. Mutually exclusive. */
	mode: "dim" | "hide";
	/** In Blur mode, reveal a circular area around the cursor while hovering a filtered reply. */
	revealOnHover: boolean;
	/** Show the number of filtered replies on the browser toolbar icon. */
	showBadgeCount: boolean;
	/** Replace X's total with the loaded, unfiltered reply count on post pages. */
	showActualReplyCount: boolean;
	/** Always show X's left navigation sidebar in its compact icon-only layout. */
	collapseSidebar: boolean;
	/** Hide X's in-timeline "Subscribe to Premium" upsell ad card. */
	hidePremiumPromo: boolean;
	/** Hide X's site footer (Terms / Privacy / Cookie links, copyright). */
	hideFooter: boolean;
	/** Replace X's header logo with the classic Twitter blue bird. */
	useBlueBird: boolean;
	/** Hide X's "What's happening" trends panel. */
	hideTrends: boolean;
	/** Hide X's "Who to follow" recommendations panel. */
	hideFollowSuggestions: boolean;
	/** Hide follow recommendations embedded in the home timeline. */
	hideTimelineFollowSuggestions: boolean;
	/** Hide the Discover more recommendations at the bottom of a post page. */
	hideDiscoverMore: boolean;
	hideTitleCount: boolean;
	hideNotificationBadges: boolean;
	hideNewPostsPrompt: boolean;
	hideGrokButton: boolean;
	hideMessageButton: boolean;
	/** Which built-in external keyword sources participate in matching. */
	keywordSourceEnabled: Record<string, boolean>;
	/** Besides body text, also match the display name and @handle. */
	matchNames: boolean;
	/** Strip whitespace and zero-width chars before matching to catch evasive forms. */
	ignoreSpaces: boolean;
	/** Case-sensitive plain keywords (regexes keep their own flags). */
	caseSensitive: boolean;
	/** Emit local diagnostic messages in the page DevTools console. */
	debugLogging: boolean;
	/** Filter promoted/ad posts using the selected filtering mode. */
	filterAds: boolean;
	/** Filter promoted posts whose creative contains video or media. */
	filterMediaAds: boolean;
	/** Filter promoted posts containing an external website card. */
	filterCardAds: boolean;
	/** Filter posts from accounts marked as parody by X. */
	filterParodyAccounts: boolean;
	/** Filter posts from accounts marked as fan accounts by X. */
	filterFanAccounts: boolean;
	/** Filter posts from accounts marked as commentary by X. */
	filterCommentaryAccounts: boolean;
	/** Filter posts from accounts marked as automated by X. */
	filterAutomatedAccounts: boolean;
	/** Which external account providers participate in matching. */
	accountSourceEnabled: Record<string, boolean>;
}

export interface KeywordSubscription {
	id: string;
	name: string;
	/** Public project page for learning about the external keyword source. */
	homepageUrl: string;
	url: string;
	enabled: boolean;
	keywords: string[] | null;
	syncedAt: number;
	/** Allow a bundled source to start empty while its maintained list grows. */
	allowEmpty?: boolean;
	etag?: string;
	syncError?: string;
}

/** Download state for one external keyword source. Source metadata lives in code. */
export interface KeywordSourceSnapshot {
	keywords: string[] | null;
	syncedAt: number;
	etag?: string;
	syncError?: string;
}

/** Persisted rules, deliberately separate from behavioral settings. */
export interface RuleData {
	keywords: {
		user: { block: string[]; allow: string[] };
		external: Record<string, KeywordSourceSnapshot>;
	};
	accounts: {
		user: { allow: string[]; block: string[] };
		external: Record<
			string,
			import("@/src/domain/account-list").AccountListSnapshot
		>;
	};
}

/** UI/runtime projection; never persist this merged shape. */
export type RuleView = Pick<AppConfig, "keywordSourceEnabled"> & {
	userKeywords: string[];
	whitelist: string[];
	accountWhitelist: string[];
	accountBlacklist: string[];
	subscriptions: KeywordSubscription[];
};

/** A rule to compile. Plain keywords are merged into big regexes; /regex/ compile separately. */
export interface Rule {
	/** Raw form (a plain keyword or /regex/flags). */
	source: string;
}

/** A compiled matcher set. */
export interface Matchers {
	/** Plain keywords merged into chunked big regexes. */
	plain: RegExp[];
	/** Normalization used to compile plain keywords; matching must use it too. */
	normalization: Pick<AppConfig, "caseSensitive" | "ignoreSpaces">;
	/** User-written /regex/ matchers. */
	custom: { source: string; re: RegExp }[];
	/** Total participating rules (plain + custom). */
	count: number;
	/** Source label (subscription name or "user") of each plain keyword, keyed by normalized form. */
	plainSources?: Map<string, string>;
	/** Source label (subscription name or "user") of each custom regex, keyed by raw rule. */
	customSources?: Map<string, string>;
}

/** Whitespace plus the zero-width / direction-control chars stripped during normalization. */
export const SPACE_AND_INVISIBLE_RE =
	/[\s\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]+/g;

/** Single-character test for zero-width / direction-control chars (no g flag). */
export const INVISIBLE_ONE_RE =
	/[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/;

/** The same char class as regex source, for building loose regexes (chars allowed between keyword chars). */
export const IGNORABLE_SRC =
	"[\\s\\u00ad\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\ufeff]*";

export const REGEX_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

/** Keys for synced behavioral settings and local rule snapshots. */
export const SETTINGS_KEY = "settings";
export const RULE_DATA_KEY = "rule-data";
