import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	vite: () => ({
		plugins: [tailwindcss()],
		build: {
			// Extension resources don't support Vite's modulepreload hints (Chrome
			// warns "cross-world extension resource mismatch" and re-fetches the
			// chunks, so the hints are pointless).
			modulePreload: false,
		},
	}),
	manifest: {
		name: "__MSG_extName__",
		short_name: "BlueNoise",
		description: "__MSG_extDescription__",
		homepage_url: "https://github.com/rokcso/bluenoise",
		version: "0.5.2",
		minimum_chrome_version: "116",
		default_locale: "en",
		permissions: ["storage", "unlimitedStorage", "alarms", "contextMenus"],
		// External keyword lists come from GitHub raw; the community account
		// blacklist/whitelist (Make X Great Again) is served from x.zuoluo.tv.
		host_permissions: [
			"https://raw.githubusercontent.com/*",
			"https://x.zuoluo.tv/*",
		],
		icons: {
			16: "icons/icon-16.png",
			32: "icons/icon-32.png",
			48: "icons/icon-48.png",
			128: "icons/icon-128.png",
		},
		action: {
			default_title: "BlueNoise",
			default_icon: {
				16: "icons/icon-16.png",
				32: "icons/icon-32.png",
			},
		},
		options_ui: {
			page: "options.html",
			open_in_tab: true,
		},
	},
});
