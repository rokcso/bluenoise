/**
 * A `chrome.*` stand-in for unit tests.
 *
 * The extension's React code talks to storage, runtime, i18n and permissions
 * directly. Rendering a real component against this fake is the difference
 * between a test that proves behaviour and a test that greps the source file
 * for a string.
 *
 * Only the surface BlueNoise actually uses is implemented. Anything else
 * throws, so an accidental new platform dependency shows up as a failing test
 * rather than silently doing nothing.
 */

type StorageArea = "local" | "sync";
type Listener = (
	changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
	area: string,
) => void;

export interface ChromeMockOptions {
	/** Seed values per area, keyed by storage key. */
	local?: Record<string, unknown>;
	sync?: Record<string, unknown>;
	/** Language reported by chrome.i18n.getUILanguage. */
	uiLanguage?: string;
	/** Result of chrome.permissions.request. */
	grantOrigin?: boolean;
}

export interface ChromeMock {
	/** Everything written through the mocked storage, per area. */
	readonly writes: {
		local: Record<string, unknown>[];
		sync: Record<string, unknown>[];
	};
	/** Messages passed to chrome.runtime.sendMessage. */
	readonly messages: unknown[];
	/** Origins asked for through chrome.permissions.request. */
	readonly requestedOrigins: string[];
	read(area: StorageArea): Record<string, unknown>;
	reset(): void;
}

interface MessageResponse {
	[key: string]: unknown;
}

export function installChromeMock(options: ChromeMockOptions = {}): ChromeMock {
	const state: Record<StorageArea, Record<string, unknown>> = {
		local: { ...(options.local ?? {}) },
		sync: { ...(options.sync ?? {}) },
	};
	const listeners = new Set<Listener>();
	const writes: {
		local: Record<string, unknown>[];
		sync: Record<string, unknown>[];
	} = { local: [], sync: [] };
	const messages: unknown[] = [];
	const requestedOrigins: string[] = [];
	const grantOrigin = options.grantOrigin ?? true;
	let onChangedInstalled = false;

	function emit(
		changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
		area: string,
	) {
		for (const listener of listeners) listener(changes, area);
	}

	function get(area: StorageArea, keys?: string | string[] | null) {
		if (keys == null) return { ...state[area] };
		const list = Array.isArray(keys) ? keys : [keys];
		const result: Record<string, unknown> = {};
		for (const key of list) {
			if (key in state[area]) result[key] = state[area][key];
		}
		return result;
	}

	function set(area: StorageArea, items: Record<string, unknown>) {
		writes[area].push({ ...items });
		const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> =
			{};
		for (const [key, value] of Object.entries(items)) {
			changes[key] = { oldValue: state[area][key], newValue: value };
			state[area][key] = value;
		}
		emit(changes, area);
	}

	const chromeApi = {
		storage: {
			local: {
				get: (keys?: string | string[] | null) =>
					Promise.resolve(get("local", keys)),
				set: (items: Record<string, unknown>) => {
					set("local", items);
					return Promise.resolve();
				},
			},
			sync: {
				get: (keys?: string | string[] | null) =>
					Promise.resolve(get("sync", keys)),
				set: (items: Record<string, unknown>) => {
					set("sync", items);
					return Promise.resolve();
				},
			},
			onChanged: {
				addListener: (listener: Listener) => {
					listeners.add(listener);
					onChangedInstalled = true;
				},
				removeListener: (listener: Listener) => {
					listeners.delete(listener);
				},
			},
		},
		runtime: {
			id: "bluenoise-test",
			sendMessage: (message: unknown) => {
				messages.push(message);
				return Promise.resolve<MessageResponse>({ ok: true });
			},
			getManifest: () => ({ version: "0.0.0-test" }),
			getURL: (path: string) => `chrome-extension://bluenoise-test/${path}`,
			onMessage: {
				addListener: () => {},
				removeListener: () => {},
			},
		},
		i18n: {
			getUILanguage: () => options.uiLanguage ?? "en",
			getMessage: (key: string) => key,
		},
		permissions: {
			request: ({ origins }: { origins: string[] }) => {
				requestedOrigins.push(...origins);
				return Promise.resolve(grantOrigin);
			},
			contains: () => Promise.resolve(false),
		},
	};

	// Replace anything a previous test installed so cross-test leakage is
	// impossible; the mock owns the global for the lifetime of the call.
	(globalThis as unknown as { chrome: unknown }).chrome = chromeApi;

	return {
		writes,
		messages,
		requestedOrigins,
		read: (area) => ({ ...state[area] }),
		reset() {
			state.local = {};
			state.sync = {};
			writes.local.length = 0;
			writes.sync.length = 0;
			messages.length = 0;
			requestedOrigins.length = 0;
			if (!onChangedInstalled) listeners.clear();
		},
	};
}
