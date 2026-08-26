/**
 * Global app config. Stored in storage.local under the single key "config".
 */
export interface AppConfig {
	/** "auto" follows the OS color scheme; "light"/"dark" force one. Popup-only. */
	theme: "auto" | "light" | "dark";
	/** UI language. "auto" follows Chrome's display language. */
	language: "auto" | "en" | "zh_CN";
	/** Master switch: turning it off instantly restores all replies. */
	enabled: boolean;
	/** "dim" = fade the whole reply; "hide" = make it disappear. Mutually exclusive. */
	mode: "dim" | "hide";
	/** In Blur mode, reveal a circular area around the cursor while hovering a filtered reply. */
	revealOnHover: boolean;
	/** Show the number of filtered replies on the browser toolbar icon. */
	showBadgeCount: boolean;
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
	hideTitleCount: boolean;
	hideNotificationBadges: boolean;
	hideNewPostsPrompt: boolean;
	hideGrokButton: boolean;
	/** User-controlled external keyword subscriptions. */
	subscriptions: KeywordSubscription[];
	/** User-defined keywords (one per line; wrap in /.../ to denote a regex). */
	userKeywords: string[];
	/**
	 * Whitelist: rules listed here never match. Both keyword lists are read-only
	 * (sync overwrites them), so "false positives" are handled here, not by
	 * editing the lists.
	 */
	whitelist: string[];
	/** Besides body text, also match the display name and @handle. */
	matchNames: boolean;
	/** Strip whitespace and zero-width chars before matching to catch evasive forms. */
	ignoreSpaces: boolean;
	/** Case-sensitive plain keywords (regexes keep their own flags). */
	caseSensitive: boolean;
	/** Emit local diagnostic messages in the page DevTools console. */
	debugLogging: boolean;
	/** Use subscribed public account-level blacklists and whitelists. */
	accountListEnabled: boolean;
	/** Enable downloaded account list providers independently of local lists. */
	externalAccountListsEnabled: boolean;
	/** Local account IDs or @handles that should always be allowed. */
	accountWhitelist: string[];
	/** Local account IDs or @handles that should always be filtered. */
	accountBlacklist: string[];
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
	etag?: string;
	syncError?: string;
}

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

/** storage.local key used to persist the config. */
export const CONFIG_KEY = "config";
