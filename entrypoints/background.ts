import { setLanguage, t } from "@/lib/i18n";
import { RULE_DATA_KEY, SETTINGS_KEY } from "@/src/contracts/config";
import {
	DEBUG_LOG_FLUSH_DELAY_MS,
	DEBUG_LOG_KEY,
	type DebugLogEntry,
	isDebugLogEntry,
	trimDebugLog,
} from "@/src/contracts/debug-log";
import {
	DEFAULT_ACCOUNT_LIST_SOURCES,
	syncAccountListSource,
} from "@/src/domain/account-list";
import {
	defaultConfig,
	defaultRuleData,
	loadConfig,
} from "@/src/domain/defaults";
import { fetchKeywordSource } from "@/src/domain/keywords";
import {
	addAccountRule,
	KEYWORD_SOURCES,
	loadRuleData,
} from "@/src/domain/rules";

export default defineBackground(() => {
	let syncInFlight = false;
	let pendingDebugLogs: DebugLogEntry[] = [];
	let debugFlushTimer: ReturnType<typeof setTimeout> | undefined;
	let debugWrite = Promise.resolve();

	function flushDebugLogs(): void {
		debugFlushTimer = undefined;
		const batch = pendingDebugLogs;
		pendingDebugLogs = [];
		if (!batch.length) return;
		debugWrite = debugWrite
			.then(async () => {
				const stored = await chrome.storage.local.get(DEBUG_LOG_KEY);
				const existing = Array.isArray(stored[DEBUG_LOG_KEY])
					? stored[DEBUG_LOG_KEY].filter(isDebugLogEntry)
					: [];
				await chrome.storage.local.set({
					[DEBUG_LOG_KEY]: trimDebugLog([...existing, ...batch]),
				});
			})
			.catch((error) =>
				console.error("[BlueNoise] Failed to persist debug logs:", error),
			);
	}

	function queueDebugLog(entry: unknown): void {
		if (!isDebugLogEntry(entry)) return;
		// Drop undefined properties and detach the message payload before batching.
		pendingDebugLogs.push(JSON.parse(JSON.stringify(entry)) as DebugLogEntry);
		if (!debugFlushTimer)
			debugFlushTimer = setTimeout(flushDebugLogs, DEBUG_LOG_FLUSH_DELAY_MS);
	}

	function clearDebugLogs(): Promise<void> {
		if (debugFlushTimer) clearTimeout(debugFlushTimer);
		debugFlushTimer = undefined;
		pendingDebugLogs = [];
		debugWrite = debugWrite.then(() =>
			chrome.storage.local.remove(DEBUG_LOG_KEY),
		);
		return debugWrite;
	}

	async function readState() {
		const [synced, local] = await Promise.all([
			chrome.storage.sync.get(SETTINGS_KEY),
			chrome.storage.local.get(RULE_DATA_KEY),
		]);
		return {
			settings: loadConfig(synced[SETTINGS_KEY] ?? defaultConfig()),
			rules: loadRuleData(local[RULE_DATA_KEY] ?? defaultRuleData()),
		};
	}

	// Public keyword sources change slowly; refresh them twice per day.
	chrome.runtime.onInstalled.addListener(async (details) => {
		chrome.alarms.create("keyword-sync", {
			delayInMinutes: 1,
			periodInMinutes: 720,
		});
		chrome.alarms.create("account-list-sync", {
			delayInMinutes: 2,
			periodInMinutes: 360,
		});
		if (details.reason !== "install") return;

		const state = await readState();
		await Promise.all([
			chrome.storage.sync.set({ [SETTINGS_KEY]: state.settings }),
			chrome.storage.local.set({ [RULE_DATA_KEY]: state.rules }),
		]);
		void syncAccounts();

		// The community list isn't bundled; fetch it on install. If it fails, the
		// popup will retry when opened.
		void syncMissingSubscriptions();
	});
	chrome.runtime.onStartup.addListener(() => {
		chrome.alarms.create("account-list-sync", {
			delayInMinutes: 1,
			periodInMinutes: 360,
		});
		void syncAccounts();
	});
	chrome.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === "keyword-sync") void syncAllSubscriptions();
		if (alarm.name === "account-list-sync") void syncAccounts();
	});
	if (chrome.contextMenus) {
		// Service workers can start more than once while the extension is alive.
		// Remove the previous instances before registering the fixed-id items.
		const menuItems = [
			{
				id: "add-keyword-allow",
				title: t("contextMenu_addKeywordWhitelist"),
			},
			{
				id: "add-account-allow",
				title: t("contextMenu_addAccountWhitelist"),
			},
			{
				id: "add-keyword-block",
				title: t("contextMenu_addKeyword"),
			},
			{
				id: "add-account-block",
				title: t("contextMenu_addAccount"),
			},
		] as const;
		const removePrev = (index: number): void => {
			if (index >= menuItems.length) return;
			const item = menuItems[index];
			// Reading lastError prevents Chrome from reporting an unchecked error
			// when this is the first worker start and no item exists yet.
			chrome.contextMenus.remove(item.id, () => {
				void chrome.runtime.lastError;
				removePrev(index + 1);
			});
		};
		removePrev(0);
		// Localize the items with the user's chosen language (not just the
		// browser locale) by seeding the message catalog from stored config.
		readState().then(({ settings: cfg }) => {
			setLanguage(cfg.language);
			for (const item of menuItems) {
				chrome.contextMenus?.create(
					{
						id: item.id,
						title: item.title,
						contexts: ["selection"],
						documentUrlPatterns: ["https://x.com/*", "https://twitter.com/*"],
					},
					() => void chrome.runtime.lastError,
				);
			}
		});
	}
	chrome.contextMenus?.onClicked.addListener((info) => {
		if (!info.selectionText) return;
		const selection = info.selectionText.trim();
		if (!selection) return;
		if (
			info.menuItemId === "add-keyword-block" ||
			info.menuItemId === "add-keyword-allow"
		) {
			void readState().then(({ rules }) => {
				const keyword = selection;
				const list =
					info.menuItemId === "add-keyword-allow"
						? rules.keywords.user.allow
						: rules.keywords.user.block;
				if (list.includes(keyword)) return;
				return chrome.storage.local.set({
					[RULE_DATA_KEY]: {
						...rules,
						keywords: {
							...rules.keywords,
							user: {
								...rules.keywords.user,
								[info.menuItemId === "add-keyword-allow" ? "allow" : "block"]: [
									...list,
									keyword,
								],
							},
						},
					},
				});
			});
		} else if (
			info.menuItemId === "add-account-block" ||
			info.menuItemId === "add-account-allow"
		) {
			void readState().then(({ rules }) => {
				// Accept a numeric X user id or an @handle; anything else is ignored.
				const next = addAccountRule(
					rules,
					info.menuItemId === "add-account-allow" ? "allow" : "block",
					{ handle: selection },
				);
				if (!next) return;
				return chrome.storage.local.set({
					[RULE_DATA_KEY]: next,
				});
			});
		}
	});

	// Badge count.
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message?.type === "BLUENOISE_COUNT") {
			const count = Number(message.count) || 0;
			const tabId = sender.tab?.id;
			if (tabId === undefined) return false;
			chrome.action
				.setBadgeText({ tabId, text: count > 0 ? String(count) : "" })
				.catch(() => {});
			chrome.action
				// A muted teal keeps the count legible without competing with the icon.
				.setBadgeBackgroundColor({ tabId, color: "#3f6f72" })
				.catch(() => {});
			sendResponse({ ok: true });
		} else if (message?.type === "BLUENOISE_DEBUG_LOG") {
			queueDebugLog(message.entry);
		} else if (message?.type === "BLUENOISE_DEBUG_CLEAR") {
			clearDebugLogs()
				.then(() => sendResponse({ ok: true }))
				.catch((error) =>
					sendResponse({
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			return true;
		} else if (message?.type === "BLUENOISE_ENSURE_SUBSCRIPTIONS") {
			// Opening the popup retries a failed first-install download without
			// replacing a successfully stored snapshot.
			void syncMissingSubscriptions();
		} else if (message?.type === "BLUENOISE_SYNC_ACCOUNT_LIST") {
			const sourceId =
				typeof message.sourceId === "string" ? message.sourceId : undefined;
			syncAccounts(sourceId ? [sourceId] : undefined)
				.then(() => sendResponse({ ok: true }))
				.catch((error) =>
					sendResponse({
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			return true;
		}
		return false;
	});

	async function syncAccounts(sourceIds?: string[]): Promise<void> {
		const { settings, rules } = await readState();
		const sources = DEFAULT_ACCOUNT_LIST_SOURCES.filter(
			(source) =>
				(!sourceIds || sourceIds.includes(source.id)) &&
				settings.accountSourceEnabled[source.id],
		);
		const external = { ...rules.accounts.external };
		await Promise.all(
			sources.map(async (source) => {
				try {
					external[source.id] = await syncAccountListSource(
						source,
						external[source.id],
					);
				} catch (error) {
					const previous = external[source.id];
					external[source.id] = {
						version: previous?.version ?? 0,
						blacklistIds: previous?.blacklistIds ?? [],
						blacklistHandles: previous?.blacklistHandles ?? [],
						whitelistIds: previous?.whitelistIds ?? [],
						whitelistHandles: previous?.whitelistHandles ?? [],
						blacklistCount: previous?.blacklistCount ?? 0,
						whitelistCount: previous?.whitelistCount ?? 0,
						syncedAt: previous?.syncedAt ?? Date.now(),
						sources: previous?.sources ?? [source.id],
						syncError: String(error instanceof Error ? error.message : error),
					};
				}
			}),
		);
		await chrome.storage.local.set({
			[RULE_DATA_KEY]: {
				...rules,
				accounts: { ...rules.accounts, external },
			},
		});
	}

	/** Fetch and store snapshots for subscriptions that have never synced. */
	async function syncMissingSubscriptions(): Promise<void> {
		if (syncInFlight) return;
		syncInFlight = true;
		try {
			const { rules } = await readState();
			const external = { ...rules.keywords.external };
			for (const source of KEYWORD_SOURCES) {
				if (external[source.id]?.keywords) continue;
				try {
					external[source.id] = {
						keywords: await fetchKeywordSource(source),
						syncedAt: Date.now(),
					};
				} catch {
					/* Keep the missing snapshot; the next popup open retries. */
				}
			}
			await chrome.storage.local.set({
				[RULE_DATA_KEY]: {
					...rules,
					keywords: { ...rules.keywords, external },
				},
			});
		} catch {
			// Storage failures are harmless; the next popup open retries.
		} finally {
			syncInFlight = false;
		}
	}
	async function syncAllSubscriptions(): Promise<void> {
		if (syncInFlight) return;
		syncInFlight = true;
		try {
			const { settings, rules } = await readState();
			const external = { ...rules.keywords.external };
			await Promise.all(
				KEYWORD_SOURCES.map(async (source) => {
					if (!settings.keywordSourceEnabled[source.id]) return;
					try {
						external[source.id] = {
							keywords: await fetchKeywordSource(source),
							syncedAt: Date.now(),
							syncError: "",
						};
					} catch (error) {
						external[source.id] = {
							keywords: external[source.id]?.keywords ?? null,
							syncedAt: external[source.id]?.syncedAt ?? 0,
							syncError: String(error instanceof Error ? error.message : error),
						};
					}
				}),
			);
			await chrome.storage.local.set({
				[RULE_DATA_KEY]: {
					...rules,
					keywords: { ...rules.keywords, external },
				},
			});
		} finally {
			syncInFlight = false;
		}
	}
});
