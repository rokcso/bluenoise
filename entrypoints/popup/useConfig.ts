import { useEffect, useState } from "react";
import { setLanguage } from "@/lib/i18n";
import type { AppConfig } from "@/src/contracts/config";
import { CONFIG_KEY } from "@/src/contracts/config";
import { loadConfig } from "@/src/domain/defaults";

/** Load config from storage.local and subscribe to changes, returning a read + update interface. */
export function useConfig() {
	const [config, setConfig] = useState<AppConfig | null>(null);

	useEffect(() => {
		chrome.storage.local.get(CONFIG_KEY, (result) => {
			const next = loadConfig(result.config);
			setLanguage(next.language);
			setConfig(next);
		});
		const onChange = (
			changes: { [key: string]: chrome.storage.StorageChange },
			area: string,
		) => {
			if (area !== "local" || !changes.config) return;
			const next = loadConfig(changes.config.newValue);
			setLanguage(next.language);
			setConfig(next);
		};
		chrome.storage.onChanged.addListener(onChange);
		return () => chrome.storage.onChanged.removeListener(onChange);
	}, []);

	/** Merge-style update: write the fields from patch into storage, triggering onChanged to sync every context. */
	function update(patch: Partial<AppConfig>) {
		if (!config) return;
		const next = { ...config, ...patch };
		setLanguage(next.language);
		chrome.storage.local.set({ config: next });
		// Apply locally immediately to avoid flicker while waiting for the storage callback.
		setConfig(next);
	}

	return { config, update };
}
