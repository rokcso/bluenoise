/**
 * Connection probe for a configured provider.
 *
 * The pure half of "Test" in the settings dialog: it builds the smallest request
 * each dialect accepts and decides whether the answer proves the endpoint, the
 * model, and the key all work. The fetch itself happens in the options page,
 * which already holds the key while the form is open.
 */

import type { AiProviderConfig } from "@/src/contracts/ai-providers";
import { AI_QUESTION_SUFFIX } from "@/src/domain/ai-filter";

/** The question key used by a judgment probe. */
export const AI_PROBE_QUESTION = `probe${AI_QUESTION_SUFFIX}`;

export interface ProviderProbe {
	url: string;
	init: RequestInit;
}

/**
 * The cheapest request that still proves the three things worth proving:
 * the URL resolves, the model name is accepted, and the key is authorized.
 * Returns null while the form is still incomplete.
 */
export function buildProviderProbe(
	provider: Pick<AiProviderConfig, "kind" | "endpoint" | "model">,
	apiKey: string,
): ProviderProbe | null {
	const url = provider.endpoint.trim();
	const model = provider.model.trim();
	if (!url || !model) return null;

	const headers = {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
	};

	if (provider.kind === "jev") {
		return {
			url,
			init: {
				method: "POST",
				headers,
				body: JSON.stringify({
					model,
					state: {
						parent_post: null,
						replies: [
							{ id: "probe", author: "BlueNoise", text: "Connection test" },
						],
					},
					questions: {
						[AI_PROBE_QUESTION]: {
							type: "noul",
							instructions:
								"Answer false: this is a connection test, not conversational noise.",
						},
					},
				}),
			},
		};
	}

	return {
		url,
		init: {
			method: "POST",
			headers,
			body: JSON.stringify({
				model,
				messages: [
					{ role: "user", content: 'Reply with the single word "ok".' },
				],
				max_tokens: 8,
			}),
		},
	};
}

export interface ProbeVerdict {
	ok: boolean;
	/** Short reason shown next to the control; absent when ok. */
	detail?: string;
}

/**
 * Decide whether a response proves the provider works. A 2xx alone is not
 * enough: gateways happily return an error document with a 200.
 */
export function judgeProbeResponse(
	kind: AiProviderConfig["kind"],
	status: number,
	payload: unknown,
): ProbeVerdict {
	if (status < 200 || status >= 300)
		return { ok: false, detail: `http-${status}` };
	const body = payload as Record<string, unknown> | null;
	if (!body || typeof body !== "object") {
		return { ok: false, detail: "unexpected-response" };
	}

	if (kind === "jev") {
		const answers = body.answers as
			| Record<string, { noul?: unknown } | undefined>
			| undefined;
		const noul = answers?.[AI_PROBE_QUESTION]?.noul;
		return typeof noul === "number" && Number.isFinite(noul)
			? { ok: true }
			: { ok: false, detail: "unexpected-response" };
	}

	const choices = body.choices;
	return Array.isArray(choices) && choices.length > 0
		? { ok: true }
		: { ok: false, detail: "unexpected-response" };
}
