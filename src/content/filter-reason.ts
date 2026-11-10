/** Behavior signals that have user-facing wording. */
export type BehaviorReasonSignal =
	| "burst"
	| "flood"
	| "cadence"
	| "regular"
	| "opening"
	| "phrase";

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
			category: "behavior";
			/** Which evidence fired; the label explains it in the user's language. */
			signal: BehaviorReasonSignal;
			/** Replies the signal looked at. */
			replies: number;
			/** Window length in seconds. */
			windowSeconds: number;
			/** Median gap in seconds, when the signal is about cadence. */
			medianGapSeconds?: number;
	  }
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
	if (reason.category === "behavior") {
		// The numbers are the point: showing "8 replies to different accounts in
		// 60s" lets the user disagree with the rule instead of trusting a black box.
		const seconds = String(reason.windowSeconds);
		const replies = String(reason.replies);
		if (reason.signal === "cadence" || reason.signal === "regular") {
			return translate(
				`filter_reason_behavior_${reason.signal}`,
				String(reason.medianGapSeconds ?? 0),
				replies,
			);
		}
		return translate(
			`filter_reason_behavior_${reason.signal}`,
			replies,
			seconds,
		);
	}
	return translate(`filter_reason_${reason.type}`);
}
