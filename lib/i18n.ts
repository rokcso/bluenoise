import en from "@/public/_locales/en/messages.json";
import zhCN from "@/public/_locales/zh_CN/messages.json";

type Language = "auto" | "en" | "zh_CN";
type Messages = Record<string, { message: string }>;

let language: Language = "auto";

/** Set the message catalog used by extension pages and content UI. */
export function setLanguage(next: Language | undefined): void {
	language = next || "auto";
}

/** Returns a localized message, interpolating $1/$2 placeholders. */
export function t(key: string, ...args: string[]): string {
	const browserLanguage = chrome.i18n.getUILanguage().toLowerCase();
	const catalog: Messages =
		language === "zh_CN" ||
		(language === "auto" && browserLanguage.startsWith("zh"))
			? zhCN
			: en;
	const template = catalog?.[key]?.message;
	if (template) {
		return template.replace(
			/\$(\d+)/g,
			(_, index: string) => args[+index - 1] ?? "",
		);
	}
	return chrome.i18n.getMessage(key, args) || key;
}
