import type { RuleData } from "@/src/contracts/config";
import { normalizeAccountEntry } from "@/src/domain/account-list";
import { asRegex, normalizeKeyword } from "@/src/domain/normalize";

export const USER_RULES_SCHEMA = 1;
export const USER_RULES_KIND = "bluenoise-user-rules";

export interface UserRulesExport {
	schema: typeof USER_RULES_SCHEMA;
	kind: typeof USER_RULES_KIND;
	exportedAt: string;
	keywords: { block: string[]; allow: string[] };
	accounts: { block: string[]; allow: string[] };
}

export interface ImportPreview {
	rules: UserRulesExport;
	ignored: number;
}

export function exportUserRules(rules: RuleData): UserRulesExport {
	return {
		schema: USER_RULES_SCHEMA,
		kind: USER_RULES_KIND,
		exportedAt: new Date().toISOString(),
		keywords: structuredClone(rules.keywords.user),
		accounts: structuredClone(rules.accounts.user),
	};
}

export function parseUserRulesImport(
	text: string,
	options: { preserveDuplicates?: boolean } = {},
): ImportPreview {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error("Import file is not valid JSON");
	}
	const data = value as Partial<UserRulesExport>;
	if (data.schema !== USER_RULES_SCHEMA || data.kind !== USER_RULES_KIND)
		throw new Error("This is not a supported BlueNoise user-rules file");
	let ignored = 0;
	const normalizeKeywords = (items: unknown): string[] => {
		if (!Array.isArray(items))
			throw new Error("Import file has invalid keywords");
		const seen = new Set<string>();
		return items.flatMap((item) => {
			if (typeof item !== "string") {
				ignored++;
				return [];
			}
			const rule = item.trim();
			if (!rule) {
				ignored++;
				return [];
			}
			const regex = asRegex(rule);
			if (regex) {
				try {
					new RegExp(regex[1], regex[2].replace(/[gy]/gi, ""));
				} catch {
					ignored++;
					return [];
				}
			}
			const key = regex ? rule : normalizeKeyword(rule, {});
			if (seen.has(key) && !options.preserveDuplicates) {
				ignored++;
				return [];
			}
			seen.add(key);
			return [rule];
		});
	};
	const normalizeAccounts = (items: unknown): string[] => {
		if (!Array.isArray(items))
			throw new Error("Import file has invalid accounts");
		const seen = new Set<string>();
		return items.flatMap((item) => {
			const entry =
				typeof item === "string" ? normalizeAccountEntry(item) : null;
			if (!entry || (seen.has(entry) && !options.preserveDuplicates)) {
				ignored++;
				return [];
			}
			seen.add(entry);
			return [/^\d+$/.test(entry) ? entry : `@${entry}`];
		});
	};
	return {
		rules: {
			schema: USER_RULES_SCHEMA,
			kind: USER_RULES_KIND,
			exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
			keywords: {
				block: normalizeKeywords(data.keywords?.block),
				allow: normalizeKeywords(data.keywords?.allow),
			},
			accounts: {
				block: normalizeAccounts(data.accounts?.block),
				allow: normalizeAccounts(data.accounts?.allow),
			},
		},
		ignored,
	};
}

export function applyUserRulesImport(
	current: RuleData,
	incoming: UserRulesExport,
	mode: "merge" | "replace" | "append",
): RuleData {
	const merge = (a: string[], b: string[]) =>
		mode === "replace" ? b : mode === "append" ? [...a, ...b] : [...new Set([...a, ...b])];
	return {
		...current,
		keywords: {
			...current.keywords,
			user: {
				block: merge(current.keywords.user.block, incoming.keywords.block),
				allow: merge(current.keywords.user.allow, incoming.keywords.allow),
			},
		},
		accounts: {
			...current.accounts,
			user: {
				block: merge(current.accounts.user.block, incoming.accounts.block),
				allow: merge(current.accounts.user.allow, incoming.accounts.allow),
			},
		},
	};
}
