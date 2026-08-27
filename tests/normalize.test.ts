import { describe, expect, it } from "vitest";
import { DEFAULTS } from "@/src/domain/defaults";
import {
	asRegex,
	buildWhitelistIndex,
	escapeRegExp,
	isSafeCustomRegex,
	looseRegex,
	normalizeKeyword,
	parseKeywordText,
	sameKeyword,
} from "@/src/domain/normalize";

const cfg = DEFAULTS;

it("调试日志默认关闭", () => {
	expect(DEFAULTS.debugLogging).toBe(false);
});

describe("normalizeKeyword", () => {
	it("去空白与零宽字符", () => {
		expect(normalizeKeyword("同 城 约", cfg)).toBe("同城约");
		expect(normalizeKeyword("a\u200bb", cfg)).toBe("ab");
		expect(normalizeKeyword("微信 \u200b 同号", cfg)).toBe("微信同号");
	});

	it("默认忽略大小写，caseSensitive 时保留", () => {
		expect(normalizeKeyword("Add Me", cfg)).toBe("addme");
		expect(normalizeKeyword("Add Me", { ...cfg, caseSensitive: true })).toBe(
			"AddMe",
		);
	});

	it("ignoreSpaces 关闭时不去空白", () => {
		expect(normalizeKeyword("a b", { ...cfg, ignoreSpaces: false })).toBe(
			"a b",
		);
	});
});

describe("asRegex", () => {
	it("识别 /正则/flags", () => {
		expect(asRegex("/\\d{4}/i")).not.toBeNull();
		expect(asRegex("普通词")).toBeNull();
	});
});

describe("isSafeCustomRegex", () => {
	it("接受常见的简单正则", () => {
		expect(isSafeCustomRegex("/\\d{4,}/i")).toBe(true);
	});
	it("拒绝嵌套量词和超长规则", () => {
		expect(isSafeCustomRegex("/(a+)+$/")).toBe(false);
		expect(isSafeCustomRegex(`/${"a".repeat(513)}/`)).toBe(false);
	});
	it("允许兼容性 flags，但拒绝不必要的高级 flags", () => {
		expect(isSafeCustomRegex("/foo/g")).toBe(true);
		expect(isSafeCustomRegex("/foo/v")).toBe(false);
	});
});

describe("buildWhitelistIndex", () => {
	it("普通词按归一化比对", () => {
		const index = buildWhitelistIndex(["求主\u200b人"], cfg);
		expect(index.has("求主人")).toBe(true);
		expect(index.has("求主")).toBe(false);
	});
	it("正则按原文比对", () => {
		const index = buildWhitelistIndex(["/\\d{6,}/"], cfg);
		expect(index.has("/\\d{6,}/")).toBe(true);
		expect(index.has("\\d{6,}")).toBe(false);
	});
});

describe("sameKeyword", () => {
	it("普通词忽略归一化差异", () => {
		expect(sameKeyword("求主\u200b人", "求主人", cfg)).toBe(true);
	});
	it("正则必须逐字相同", () => {
		expect(sameKeyword("/ab/i", "/AB/i", cfg)).toBe(false);
		expect(sameKeyword("/ab/i", "/ab/i", cfg)).toBe(true);
	});
});

describe("parseKeywordText", () => {
	it("忽略注释行", () => {
		expect(parseKeywordText("# 说明\n广告\n# another\n")).toEqual(["广告"]);
	});
	it("去空行、去重、去首尾空白", () => {
		expect(parseKeywordText(" a \n a \n\n b \n")).toEqual(["a", "b"]);
	});
});

describe("looseRegex", () => {
	it("字间允许夹空白/零宽字符", () => {
		const re = looseRegex("同城约", cfg);
		if (!re) throw new Error("expected a regex");
		re.lastIndex = 0;
		expect(re.test("同 城 约")).toBe(true);
		re.lastIndex = 0;
		expect(re.test("同城约")).toBe(true);
	});
	it("正则直接复用", () => {
		const re = looseRegex("/\\d{4,}/", cfg);
		if (!re) throw new Error("expected a regex");
		re.lastIndex = 0;
		expect(re.test("abc12345")).toBe(true);
	});
	it("ignoreSpaces 关闭时不加宽松 joiner", () => {
		const re = looseRegex("同城约", { ...cfg, ignoreSpaces: false });
		if (!re) throw new Error("expected a regex");
		re.lastIndex = 0;
		expect(re.test("同 城 约")).toBe(false);
		re.lastIndex = 0;
		expect(re.test("同城约")).toBe(true);
	});
});

describe("escapeRegExp", () => {
	it("转义正则元字符", () => {
		expect(escapeRegExp("a.b")).toBe("a\\.b");
	});
});
