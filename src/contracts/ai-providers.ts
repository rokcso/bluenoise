/**
 * AI provider registry.
 *
 * Two kinds share one shape and one storage location:
 *
 *  - `jev`  judgment models ({@link AI_PROVIDER} dialect): they answer a typed
 *           question with a calibrated probability, which is what the
 *           experimental second pass needs.
 *  - `llm`  ordinary chat-completion models, reserved for features that ask a
 *           model to write something rather than score it. Nothing consumes
 *           them yet; they exist so a later feature does not need a migration.
 *
 * Only non-secret data lives here, so it travels through `storage.sync` with
 * the rest of the settings. API keys live in `storage.local`, keyed by the same
 * provider id — see `AiSecrets`.
 */

import { AI_DEFAULT_PROVIDER_ID, AI_PROVIDER } from "./ai";

export type AiProviderKind = "jev" | "llm";
export type AiProviderDialect = "systemone" | "openai-chat";

export interface AiProviderConfig {
	/** Stable id; the key for this provider's secret, cache, and quota guard. */
	id: string;
	kind: AiProviderKind;
	/** Shown in pickers. Free text, may be empty while the user types. */
	label: string;
	/**
	 * Full request URL rather than a base URL plus a guessed path: gateways put
	 * the same endpoint behind wildly different prefixes, and guessing is how
	 * "works for me" bugs are born.
	 */
	endpoint: string;
	model: string;
	/** Built-in entries can be renamed and retargeted, but never removed. */
	builtin?: boolean;
}

/** The provider the extension ships with. Mirrors `AI_PROVIDER` metadata. */
export const AI_BUILTIN_PROVIDER: AiProviderConfig = {
	id: AI_DEFAULT_PROVIDER_ID,
	kind: "jev",
	label: "TypeSafe (Jev)",
	endpoint: AI_PROVIDER.endpoint,
	model: AI_PROVIDER.model,
	builtin: true,
};

/** The wire dialect implied by a provider's kind. */
export function dialectFor(kind: AiProviderKind): AiProviderDialect {
	return kind === "jev" ? "systemone" : "openai-chat";
}

/**
 * Host permission pattern for a provider's endpoint, or null when the URL is
 * not yet usable. Endpoints are saved as the user types, so this is a
 * validation helper, not a gate on what may be stored.
 */
export function originPatternFor(endpoint: string): string | null {
	try {
		const url = new URL(endpoint.trim());
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		return `${url.origin}/*`;
	} catch {
		return null;
	}
}

/**
 * Normalize whatever is stored into a usable registry.
 *
 * Deliberately tolerant: a half-typed endpoint must not delete the row the user
 * is editing, so only the id has to be sound. Everything else is validated at
 * the point of use (permission request, fetch).
 */
export function parseAiProviders(value: unknown): AiProviderConfig[] {
	const list = Array.isArray(value) ? value : [];
	const seen = new Set<string>();
	const providers: AiProviderConfig[] = [];

	for (const entry of list) {
		const stored = entry as Partial<AiProviderConfig> | undefined;
		const id = typeof stored?.id === "string" ? stored.id.trim() : "";
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const builtin = id === AI_DEFAULT_PROVIDER_ID || stored?.builtin === true;
		providers.push({
			id,
			// The built-in provider speaks the judgment dialect; forcing it keeps a
			// hand-edited config from pointing the second pass at a chat model.
			kind:
				id === AI_DEFAULT_PROVIDER_ID
					? "jev"
					: stored?.kind === "llm"
						? "llm"
						: "jev",
			label: typeof stored?.label === "string" ? stored.label : "",
			endpoint:
				typeof stored?.endpoint === "string" ? stored.endpoint.trim() : "",
			model: typeof stored?.model === "string" ? stored.model.trim() : "",
			...(builtin ? { builtin: true } : {}),
		});
	}

	if (!seen.has(AI_DEFAULT_PROVIDER_ID)) {
		providers.unshift({ ...AI_BUILTIN_PROVIDER });
	}
	return providers;
}

/** Providers of one kind, in registry order. */
export function providersOfKind(
	providers: AiProviderConfig[],
	kind: AiProviderKind,
): AiProviderConfig[] {
	return providers.filter((provider) => provider.kind === kind);
}

/**
 * The provider a judgment feature should call. Falls back to the built-in one
 * so a deleted or retyped selection can never leave a feature pointing at
 * nothing.
 */
export function resolveJevProvider(
	providers: AiProviderConfig[],
	selectedId: string,
): AiProviderConfig {
	const selected = providers.find(
		(provider) => provider.id === selectedId && provider.kind === "jev",
	);
	if (selected) return selected;
	return (
		providers.find((provider) => provider.id === AI_DEFAULT_PROVIDER_ID) ??
		providers.find((provider) => provider.kind === "jev") ?? {
			...AI_BUILTIN_PROVIDER,
		}
	);
}

/** Id for a provider the user just added. */
export function createProviderId(): string {
	return `p-${crypto.randomUUID().slice(0, 8)}`;
}
