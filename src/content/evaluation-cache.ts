export type ArticlePreset =
	| "ad"
	| "parody"
	| "fan"
	| "commentary"
	| "automated";

interface FastCacheInput {
	cachedSignature: string;
	cachedPreset?: ArticlePreset;
	currentPreset?: ArticlePreset;
	textDirty: boolean;
	generation: number;
	accountListVersion: number;
	separator: string;
}

/** Cheap guard used before reading article text and constructing its full signature. */
export function canReuseFastEvaluation(input: FastCacheInput): boolean {
	return (
		input.cachedPreset === input.currentPreset &&
		!input.textDirty &&
		input.cachedSignature.startsWith(
			`${input.generation}${input.separator}${input.accountListVersion}${input.separator}`,
		)
	);
}
