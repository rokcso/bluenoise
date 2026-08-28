const INVALIDATED_CONTEXT_MESSAGE = "Extension context invalidated";

export function isExtensionContextInvalidatedError(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.includes(INVALIDATED_CONTEXT_MESSAGE)
	);
}

/** Returns false when the obsolete content-script instance must stop its batch. */
export function handleContentProcessingError(
	error: unknown,
	onInvalidated: () => void,
	report: (error: unknown) => void,
): boolean {
	if (isExtensionContextInvalidatedError(error)) {
		onInvalidated();
		return false;
	}
	report(error);
	return true;
}
