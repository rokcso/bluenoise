import { useEffect, useState } from "react";
import { setLanguage } from "@/lib/i18n";
import type { AppConfig, RuleData, RuleView } from "@/src/contracts/config";
import { RULE_DATA_KEY, SETTINGS_KEY } from "@/src/contracts/config";
import {
	defaultConfig,
	defaultRuleData,
	loadConfig,
} from "@/src/domain/defaults";
import { createRuleView, loadRuleData } from "@/src/domain/rules";

type ViewConfig = AppConfig & RuleView;

function read(settingsValue: unknown, rulesValue: unknown): ViewConfig {
	const settings = loadConfig(settingsValue ?? defaultConfig());
	const rules = loadRuleData(rulesValue ?? defaultRuleData());
	return { ...settings, ...createRuleView(settings, rules) };
}

/** Load config from storage.local and subscribe to changes, returning a read + update interface. */
export function useConfig() {
	const [config, setConfig] = useState<ViewConfig | null>(null);

	useEffect(() => {
		const reload = () =>
			Promise.all([
				chrome.storage.sync.get(SETTINGS_KEY),
				chrome.storage.local.get(RULE_DATA_KEY),
			]).then(([synced, local]) => {
				const next = read(synced[SETTINGS_KEY], local[RULE_DATA_KEY]);
				setLanguage(next.language);
				setConfig(next);
			});
		void reload();
		const onChange = (
			changes: { [key: string]: chrome.storage.StorageChange },
			area: string,
		) => {
			if (
				(area !== "sync" || !changes[SETTINGS_KEY]) &&
				(area !== "local" || !changes[RULE_DATA_KEY])
			)
				return;
			void reload();
		};
		chrome.storage.onChanged.addListener(onChange);
		return () => chrome.storage.onChanged.removeListener(onChange);
	}, []);

	/** Merge-style update: write the fields from patch into storage, triggering onChanged to sync every context. */
	function update(patch: Partial<ViewConfig>) {
		if (!config) return;
		const next = { ...config, ...patch } as ViewConfig;
		setLanguage(next.language);
		const {
			userKeywords,
			whitelist,
			accountWhitelist,
			accountBlacklist,
			subscriptions,
			...settings
		} = next;
		settings.keywordSourceEnabled = Object.fromEntries(
			subscriptions.map((source) => [source.id, source.enabled]),
		);
		chrome.storage.local.get(RULE_DATA_KEY, (stored) => {
			const current = loadRuleData(stored[RULE_DATA_KEY] ?? defaultRuleData());
			const rules: RuleData = {
				keywords: {
					user: { block: userKeywords, allow: whitelist },
					external: Object.fromEntries(
						subscriptions.map((source) => [
							source.id,
							{
								keywords: source.keywords,
								syncedAt: source.syncedAt,
								etag: source.etag,
								syncError: source.syncError,
							},
						]),
					),
				},
				accounts: {
					user: { allow: accountWhitelist, block: accountBlacklist },
					external: current.accounts.external,
				},
			};
			void Promise.all([
				chrome.storage.sync.set({ [SETTINGS_KEY]: settings }),
				chrome.storage.local.set({ [RULE_DATA_KEY]: rules }),
			]);
		});
		// Apply locally immediately to avoid flicker while waiting for the storage callback.
		setConfig(next);
	}

	return { config, update };
}
