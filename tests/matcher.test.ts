import { describe, expect, it } from "vitest";
import type { AppConfig } from "@/src/contracts/config";
import { DEFAULTS } from "@/src/domain/defaults";
import { buildMatchers, matchAny } from "@/src/domain/matcher";
import { KEYWORD_SOURCES } from "@/src/domain/rules";

function cfg(overrides: Partial<AppConfig> = {}): AppConfig {
	return { ...DEFAULTS, ...overrides };
}

describe("buildMatchers", () => {
	it("跳过危险的自定义正则", () => {
		const m = buildMatchers(cfg({ userKeywords: ["/(a+)+$/"] }));
		expect(m.custom).toHaveLength(0);
	});
	it("合并普通词 + 自定义正则，白名单命中被跳过", () => {
		const c = cfg({
			userKeywords: ["加微信", "广告", "/\\d{6,}/"],
			whitelist: ["加微信"],
		});
		const m = buildMatchers(c);
		expect(m.count).toBe(2);
		expect(matchAny(m, "点我看广告")).toBe("广告");
		// 白名单里的词不再命中
		expect(matchAny(m, "加微信 xxx")).toBeNull();
		// 正则生效
		expect(matchAny(m, "验证码 1234567")).toBe("/\\d{6,}/");
	});

	it("长词优先，命中报告最具体的词", () => {
		const m = buildMatchers(cfg({ userKeywords: ["微信", "加微信"] }));
		expect(matchAny(m, "请加微信联系")).toBe("加微信");
	});

	it("去重：同样的词只算一次", () => {
		const m = buildMatchers(
			cfg({ userKeywords: ["加微信", "加微信", "/ab/", "/ab/"] }),
		);
		expect(m.count).toBe(2);
	});

	it("无效正则被忽略，不影响其它词", () => {
		const m = buildMatchers(cfg({ userKeywords: ["加微信", "/[unclosed/"] }));
		expect(m.count).toBe(1);
		expect(matchAny(m, "加微信")).toBe("加微信");
	});

	it("关闭外部订阅后对应词库不参与", () => {
		const m = buildMatchers(
			cfg({
				subscriptions: [
					{
						...KEYWORD_SOURCES[0],
						keywords: ["贷款"],
						enabled: true,
						syncedAt: 0,
					},
					{
						...KEYWORD_SOURCES[1],
						keywords: ["广告"],
						enabled: false,
						syncedAt: 0,
					},
				],
			}),
		);
		expect(matchAny(m, "无抵押贷款")).toBe("贷款");
	});
});

describe("matchAny", () => {
	it("空文本不匹配", () => {
		const m = buildMatchers(cfg({ userKeywords: ["加微信"] }));
		expect(matchAny(m, "")).toBeNull();
	});

	it("拆字规避仍能命中", () => {
		const m = buildMatchers(cfg({ userKeywords: ["同城约"] }));
		expect(matchAny(m, "同 城 约 炮")).toBe("同城约");
	});

	it("关闭忽略空格后保留正常空格，也不匹配拆字规避", () => {
		const m = buildMatchers(
			cfg({ ignoreSpaces: false, userKeywords: ["同 城", "同城"] }),
		);
		expect(matchAny(m, "同 城")).toBe("同 城");
		expect(matchAny(m, "同 城 约")).toBe("同 城");
		const compactOnly = buildMatchers(
			cfg({ ignoreSpaces: false, userKeywords: ["同城约"] }),
		);
		expect(matchAny(compactOnly, "同 城 约")).toBeNull();
	});
});
