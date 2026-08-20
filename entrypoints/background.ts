import { setLanguage, t } from "@/lib/i18n";
import type { AppConfig } from "@/src/contracts/config";
import { CONFIG_KEY } from "@/src/contracts/config";
import {
	ACCOUNT_LIST_KEY,
	type AccountListSnapshot,
	syncAccountLists,
} from "@/src/domain/account-list";
import { defaultConfig } from "@/src/domain/defaults";
import { fetchKeywordSource } from "@/src/domain/keywords";

export default defineBackground(() => {
	let syncInFlight = false;

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
		void syncAccounts();
		if (details.reason !== "install") return;

		const { config } = await chrome.storage.local.get(CONFIG_KEY);
		if (!config) {
			await chrome.storage.local.set({ config: defaultConfig() });
		}

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
		// Remove the previous instance before registering the fixed-id menu item.
		chrome.contextMenus.remove("add-keyword", () => {
			// Reading lastError prevents Chrome from reporting an unchecked error
			// when this is the first worker start and no item exists yet.
			void chrome.runtime.lastError;
			// Localize the item with the user's chosen language (not just the
			// browser locale) by seeding the message catalog from stored config.
			chrome.storage.local.get(CONFIG_KEY).then(({ config }) => {
				const cfg = (config ?? defaultConfig()) as AppConfig;
				setLanguage(cfg.language);
				chrome.contextMenus?.create(
					{
						id: "add-keyword",
						title: t("contextMenu_addKeyword"),
						contexts: ["selection"],
						documentUrlPatterns: ["https://x.com/*", "https://twitter.com/*"],
					},
					() => void chrome.runtime.lastError,
				);
			});
		});
	}
	chrome.contextMenus?.onClicked.addListener((info) => {
		if (info.menuItemId !== "add-keyword" || !info.selectionText) return;
		void chrome.storage.local.get(CONFIG_KEY).then(({ config }) => {
			const latest = (config ?? defaultConfig()) as AppConfig;
			const keyword = info.selectionText?.trim();
			if (!keyword || latest.userKeywords.includes(keyword)) return;
			return chrome.storage.local.set({
				config: { ...latest, userKeywords: [...latest.userKeywords, keyword] },
			});
		});
	});

	// Badge count.
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message?.type === "XSF_COUNT") {
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
		} else if (message?.type === "XSF_ENSURE_SUBSCRIPTIONS") {
			// Opening the popup retries a failed first-install download without
			// replacing a successfully stored snapshot.
			void syncMissingSubscriptions();
		} else if (message?.type === "XSF_SYNC_ACCOUNT_LIST") {
			syncAccounts(true)
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

	async function syncAccounts(force = false): Promise<void> {
		if (!force) {
			const { config } = await chrome.storage.local.get(CONFIG_KEY);
			const current = (config ?? defaultConfig()) as AppConfig;
			if (!current.externalAccountListsEnabled) return;
		}
		try {
			const previous = (await chrome.storage.local.get(ACCOUNT_LIST_KEY))[
				ACCOUNT_LIST_KEY
			] as AccountListSnapshot | undefined;
			const snapshot = await syncAccountLists(undefined, previous);
			await chrome.storage.local.set({ [ACCOUNT_LIST_KEY]: snapshot });
		} catch (error) {
			const result = await chrome.storage.local.get(ACCOUNT_LIST_KEY);
			const previous = result[ACCOUNT_LIST_KEY] as
				| AccountListSnapshot
				| undefined;
			if (previous) {
				await chrome.storage.local.set({
					[ACCOUNT_LIST_KEY]: {
						...previous,
						syncError: String(error instanceof Error ? error.message : error),
					},
				});
			}
		}
	}

	/** Fetch and store snapshots for subscriptions that have never synced. */
	async function syncMissingSubscriptions(): Promise<void> {
		if (syncInFlight) return;
		syncInFlight = true;
		try {
			const { config } = await chrome.storage.local.get(CONFIG_KEY);
			const cfg = (config ?? defaultConfig()) as AppConfig;
			const subscriptions = [...(cfg.subscriptions ?? [])];
			for (let i = 0; i < subscriptions.length; i++) {
				const source = subscriptions[i];
				if (source.keywords) continue;
				try {
					subscriptions[i] = {
						...source,
						keywords: await fetchKeywordSource(source),
						syncedAt: Date.now(),
					};
				} catch {
					/* Keep the missing snapshot; the next popup open retries. */
				}
			}
			const { config: latestConfig } =
				await chrome.storage.local.get(CONFIG_KEY);
			const latest = (latestConfig ?? defaultConfig()) as AppConfig;
			await chrome.storage.local.set({ config: { ...latest, subscriptions } });
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
			const { config } = await chrome.storage.local.get(CONFIG_KEY);
			const latest = (config ?? defaultConfig()) as AppConfig;
			const subscriptions = await Promise.all(
				latest.subscriptions.map(async (source) => {
					if (!source.enabled) return source;
					try {
						return {
							...source,
							keywords: await fetchKeywordSource(source),
							syncedAt: Date.now(),
							syncError: "",
						};
					} catch (error) {
						return {
							...source,
							syncError: String(error instanceof Error ? error.message : error),
						};
					}
				}),
			);
			await chrome.storage.local.set({ config: { ...latest, subscriptions } });
		} finally {
			syncInFlight = false;
		}
	}
});
