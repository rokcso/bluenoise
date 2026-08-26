import { setLanguage, t } from "@/lib/i18n";
import { RULE_DATA_KEY, SETTINGS_KEY } from "@/src/contracts/config";
import {
	DEFAULT_ACCOUNT_LIST_SOURCES,
	normalizeAccountEntry,
	syncAccountListSource,
} from "@/src/domain/account-list";
import {
	defaultConfig,
	defaultRuleData,
	loadConfig,
} from "@/src/domain/defaults";
import { fetchKeywordSource } from "@/src/domain/keywords";
import { KEYWORD_SOURCES, loadRuleData } from "@/src/domain/rules";

export default defineBackground(() => {
	let syncInFlight = false;

	async function readState() {
		const stored = await chrome.storage.local.get([
			SETTINGS_KEY,
			RULE_DATA_KEY,
		]);
		return {
			settings: loadConfig(stored[SETTINGS_KEY] ?? defaultConfig()),
			rules: loadRuleData(stored[RULE_DATA_KEY] ?? defaultRuleData()),
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
		void syncAccounts();
		if (details.reason !== "install") return;

		const state = await readState();
		await chrome.storage.local.set({
			[SETTINGS_KEY]: state.settings,
			[RULE_DATA_KEY]: state.rules,
		});

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
				id: "add-keyword",
				title: t("contextMenu_addKeyword"),
			},
			{
				id: "add-account",
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
		if (info.menuItemId === "add-keyword") {
			void readState().then(({ rules }) => {
				const keyword = selection;
				if (rules.keywords.user.block.includes(keyword)) return;
				return chrome.storage.local.set({
					[RULE_DATA_KEY]: {
						...rules,
						keywords: {
							...rules.keywords,
							user: {
								...rules.keywords.user,
								block: [...rules.keywords.user.block, keyword],
							},
						},
					},
				});
			});
		} else if (info.menuItemId === "add-account") {
			void readState().then(({ rules }) => {
				// Accept a numeric X user id or an @handle; anything else is ignored.
				const entry = normalizeAccountEntry(selection);
				if (!entry) return;
				const already = rules.accounts.user.block.some(
					(item) => normalizeAccountEntry(item) === entry,
				);
				if (already) return;
				const stored = /^\d+$/.test(entry) ? entry : `@${entry}`;
				return chrome.storage.local.set({
					[RULE_DATA_KEY]: {
						...rules,
						accounts: {
							...rules.accounts,
							user: {
								...rules.accounts.user,
								block: [...rules.accounts.user.block, stored],
							},
						},
					},
				});
			});
		}
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
			const sourceId =
				typeof message.sourceId === "string" ? message.sourceId : undefined;
			syncAccounts(true, sourceId ? [sourceId] : undefined)
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

	async function syncAccounts(
		force = false,
		sourceIds?: string[],
	): Promise<void> {
		if (!force) {
			const { settings: current } = await readState();
			if (!current.externalAccountListsEnabled) return;
		}
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
