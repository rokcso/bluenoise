export type FilterReason =
	| {
			category: "keyword";
			kind: "plain" | "regex";
			rule: string;
			source: string;
	  }
	| { category: "account"; source: string }
	| { category: "ai"; probability: number }
	| {
			category: "preset";
			type: "ad" | "parody" | "fan" | "commentary" | "automated";
	  };

type Translate = (key: string, ...args: string[]) => string;

const REGEX_PREVIEW_LENGTH = 12;

export function previewRule(rule: string, kind: "plain" | "regex"): string {
	if (kind !== "regex" || [...rule].length <= REGEX_PREVIEW_LENGTH) return rule;
	return `${[...rule].slice(0, REGEX_PREVIEW_LENGTH).join("")}...`;
}

export function formatFilterReason(
	reason: FilterReason,
	translate: Translate,
): string {
	if (reason.category === "keyword") {
		const rule = previewRule(reason.rule, reason.kind);
		return reason.source === "user"
			? translate("filter_reason_user_keyword", rule)
			: translate("filter_reason_external_keyword", reason.source, rule);
	}
	if (reason.category === "account") {
		return reason.source === "user"
			? translate("filter_reason_user_account")
			: translate("filter_reason_external_account", reason.source);
	}
	if (reason.category === "ai") {
		return translate(
			"filter_reason_ai",
			`${Math.round(reason.probability * 100)}%`,
		);
	}
	return translate(`filter_reason_${reason.type}`);
}
