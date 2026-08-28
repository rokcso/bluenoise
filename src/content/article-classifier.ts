import type { FilterReason } from "@/src/content/filter-reason";
import type { Matchers } from "@/src/contracts/config";
import type {
	AccountIdentity,
	AccountMatchSource,
} from "@/src/domain/account-list";
import { matchAccountSources } from "@/src/domain/account-list";
import { matchDetail } from "@/src/domain/matcher";

export interface FilteredLog {
	handle?: string;
	id?: string;
	category: "keyword" | "account" | "preset";
	preset?: NonNullable<ArticleFacts["preset"]>;
	field?: "body" | "name";
	rule?: string;
	source?: string;
	kind?: "plain" | "regex";
	snippet?: string;
}

export interface ArticleFacts {
	body: string;
	name: string;
	identity: AccountIdentity;
	preset?: "ad" | "parody" | "fan" | "commentary" | "automated";
}

export interface FilterContext {
	matchers: Matchers;
	accountSources: AccountMatchSource[];
	accountWhitelist: string[];
	accountBlacklist: string[];
	accountSourceNames: ReadonlyMap<string, string>;
	debugLogging: boolean;
}

export interface FilterDecision {
	hit: string | null;
	reason: FilterReason | null;
	log: FilteredLog | null;
}

const PRESET_HITS: Record<NonNullable<ArticleFacts["preset"]>, string> = {
	ad: "__ad__",
	parody: "__parody__",
	fan: "__fan__",
	commentary: "__commentary__",
	automated: "__automated__",
};

/** Apply filtering precedence to facts already read from an X article. */
export function classifyArticle(
	facts: ArticleFacts,
	context: FilterContext,
): FilterDecision {
	if (facts.preset) {
		return {
			hit: PRESET_HITS[facts.preset],
			reason: { category: "preset", type: facts.preset },
			log: context.debugLogging
				? {
						handle: facts.identity.handle,
						id: facts.identity.id,
						category: "preset",
						preset: facts.preset,
					}
				: null,
		};
	}

	const accountMatch = matchAccountSources(
		context.accountSources,
		facts.identity,
		context.accountWhitelist,
		context.accountBlacklist,
	);
	if (accountMatch?.decision === "blacklist") {
		const source =
			accountMatch.source === "user"
				? "user"
				: (context.accountSourceNames.get(accountMatch.source) ??
					accountMatch.source);
		return {
			hit: "account:blacklist",
			reason: { category: "account", source },
			log: context.debugLogging
				? {
						handle: facts.identity.handle,
						id: facts.identity.id,
						category: "account",
					}
				: null,
		};
	}
	if (accountMatch?.decision === "whitelist")
		return { hit: null, reason: null, log: null };

	const bodyMatch = matchDetail(context.matchers, facts.body);
	const nameMatch = facts.name
		? matchDetail(context.matchers, facts.name)
		: null;
	const match = bodyMatch ?? nameMatch;
	if (!match) return { hit: null, reason: null, log: null };
	const field = bodyMatch ? "body" : "name";
	return {
		hit: match.hit,
		reason: {
			category: "keyword",
			kind: match.kind,
			rule: match.rule,
			source: match.source ?? "user",
		},
		log: context.debugLogging
			? {
					handle: facts.identity.handle,
					id: facts.identity.id,
					category: "keyword",
					field,
					rule: match.hit,
					source: match.source ?? undefined,
					kind: match.kind,
					snippet: match.snippet,
				}
			: null,
	};
}
