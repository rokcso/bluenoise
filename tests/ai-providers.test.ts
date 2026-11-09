import { describe, expect, it } from "vitest";
import { AI_DEFAULT_PROVIDER_ID } from "@/src/contracts/ai";
import {
	AI_BUILTIN_PROVIDER,
	dialectFor,
	originPatternFor,
	parseAiProviders,
	providersOfKind,
	resolveJevProvider,
} from "@/src/contracts/ai-providers";

describe("ai provider registry", () => {
	it("always offers the built-in judgment provider", () => {
		const providers = parseAiProviders(undefined);
		expect(providers).toHaveLength(1);
		expect(providers[0].id).toBe(AI_DEFAULT_PROVIDER_ID);
		expect(providers[0].kind).toBe("jev");
		expect(providers[0].builtin).toBe(true);
		expect(providers[0].endpoint).toBe(AI_BUILTIN_PROVIDER.endpoint);
	});

	it("keeps a half-typed endpoint instead of deleting the row", () => {
		// Providers are persisted on every keystroke; dropping an incomplete URL
		// would erase what the user is in the middle of typing.
		const providers = parseAiProviders([
			{
				id: "custom",
				kind: "jev",
				label: "Mine",
				endpoint: "https:/",
				model: "",
			},
		]);
		expect(providers.map((provider) => provider.id)).toEqual([
			AI_DEFAULT_PROVIDER_ID,
			"custom",
		]);
		expect(providers[1].endpoint).toBe("https:/");
	});

	it("drops entries with no id and de-duplicates ids", () => {
		const providers = parseAiProviders([
			{ kind: "jev", label: "no id" },
			{ id: "dup", kind: "jev", label: "first" },
			{ id: "dup", kind: "llm", label: "second" },
		]);
		expect(providers.map((provider) => provider.id)).toEqual([
			AI_DEFAULT_PROVIDER_ID,
			"dup",
		]);
		expect(providers[1].label).toBe("first");
	});

	it("keeps the built-in provider on the judgment dialect even if edited", () => {
		const providers = parseAiProviders([
			{ id: AI_DEFAULT_PROVIDER_ID, kind: "llm", endpoint: "https://x.test" },
		]);
		expect(providers[0].kind).toBe("jev");
		expect(providers[0].builtin).toBe(true);
	});

	it("splits the two kinds", () => {
		const providers = parseAiProviders([
			{ id: "chat", kind: "llm", label: "Chat" },
		]);
		expect(providersOfKind(providers, "jev").map((p) => p.id)).toEqual([
			AI_DEFAULT_PROVIDER_ID,
		]);
		expect(providersOfKind(providers, "llm").map((p) => p.id)).toEqual([
			"chat",
		]);
	});

	it("maps a kind to its wire dialect", () => {
		expect(dialectFor("jev")).toBe("systemone");
		expect(dialectFor("llm")).toBe("openai-chat");
	});

	it("resolves a stale or cross-kind selection to a judgment provider", () => {
		const providers = parseAiProviders([
			{ id: "chat", kind: "llm", label: "Chat" },
		]);
		// Deleted provider id.
		expect(resolveJevProvider(providers, "gone").id).toBe(
			AI_DEFAULT_PROVIDER_ID,
		);
		// Selection pointing at a chat model.
		expect(resolveJevProvider(providers, "chat").id).toBe(
			AI_DEFAULT_PROVIDER_ID,
		);
		// A valid selection wins.
		expect(resolveJevProvider(providers, AI_DEFAULT_PROVIDER_ID).id).toBe(
			AI_DEFAULT_PROVIDER_ID,
		);
	});

	it("narrows an endpoint to a host permission pattern", () => {
		expect(originPatternFor("https://api.typesafe.ai/v1/systemone")).toBe(
			"https://api.typesafe.ai/*",
		);
		expect(originPatternFor("http://127.0.0.1:8080/v1/chat/completions")).toBe(
			"http://127.0.0.1:8080/*",
		);
		expect(originPatternFor("https:/")).toBeNull();
		expect(originPatternFor("")).toBeNull();
		expect(originPatternFor("ftp://example.com/x")).toBeNull();
	});
});
