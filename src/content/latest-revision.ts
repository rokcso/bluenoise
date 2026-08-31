export interface LatestRevision {
	issue(): number;
	isCurrent(revision: number): boolean;
}

/** Discards results from asynchronous work superseded by a newer request. */
export function createLatestRevision(): LatestRevision {
	let current = 0;
	return {
		issue: () => ++current,
		isCurrent: (revision) => revision === current,
	};
}
