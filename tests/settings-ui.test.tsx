// @vitest-environment happy-dom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsApp } from "@/entrypoints/popup/App";
import en from "@/public/_locales/en/messages.json";
import { AI_PROVIDER_TEST_KEY, AI_SECRETS_KEY } from "@/src/contracts/ai";
import { SETTINGS_KEY } from "@/src/contracts/config";
import { DEBUG_LOG_KEY, type DebugLogEntry } from "@/src/contracts/debug-log";
import { DEFAULTS } from "@/src/domain/defaults";
import { installChromeMock } from "./helpers/chrome-mock";

/** The copy a user actually sees; asserting on it keeps the test honest. */
function copy(key: keyof typeof en): string {
	return en[key].message;
}

/**
 * These replace a set of tests that grepped App.tsx for strings. They render
 * the real settings screen against a fake `chrome` and assert what a user can
 * actually observe, so refactoring the markup no longer breaks them.
 */

function setup(
	settings: Record<string, unknown> = {},
	local: Record<string, unknown> = {},
) {
	const chrome = installChromeMock({
		sync: { [SETTINGS_KEY]: { ...DEFAULTS, ...settings } },
		local,
	});
	const view = render(<SettingsApp activeSection="filtering" />);
	return { chrome, view };
}

/** The slider is the only range input on the filtering page. */
function dimSlider(): HTMLInputElement {
	const slider = document.querySelector<HTMLInputElement>(
		'input[type="range"]',
	);
	if (!slider) throw new Error("dim opacity slider not rendered");
	return slider;
}

afterEach(cleanup);

describe("filtering settings", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("shows the stored dim opacity", async () => {
		setup({ mode: "dim", dimOpacity: 0.35 });

		await waitFor(() => expect(dimSlider().value).toBe("0.35"));
	});

	it("writes a new dim opacity to the settings that sync", async () => {
		const { chrome } = setup({ mode: "dim", dimOpacity: 0.35 });
		await waitFor(() => expect(dimSlider()).toBeTruthy());

		fireEvent.change(dimSlider(), { target: { value: "0.6" } });

		await waitFor(() => {
			const writes = chrome.writes.sync.flatMap((write) =>
				Object.entries(write),
			);
			expect(writes).toContainEqual([
				SETTINGS_KEY,
				expect.objectContaining({ dimOpacity: 0.6 }),
			]);
		});
	});

	it("previews the dim opacity on a sample post", async () => {
		setup({ mode: "dim", dimOpacity: 0.4 });
		await waitFor(() => expect(dimSlider()).toBeTruthy());

		const preview = document.querySelector<HTMLElement>(
			".pointer-events-none.select-none",
		);
		expect(preview?.style.opacity).toBe("0.4");
	});

	it("keeps the slider mounted but inert outside dim mode", async () => {
		setup({ mode: "collapse" });
		await waitFor(() => expect(dimSlider()).toBeTruthy());

		// The control stays mounted so its value survives a mode round-trip; it
		// is `inert` (not removed) so tabbing skips it and the height can animate.
		const reveal = document.querySelector<HTMLElement>(".settings-reveal");
		expect(reveal).not.toBeNull();
		expect(reveal?.inert).toBe(true);
		expect(reveal?.dataset.open).toBe("false");
	});

	it("makes the slider reachable again in dim mode", async () => {
		setup({ mode: "dim" });
		await waitFor(() => expect(dimSlider()).toBeTruthy());

		const reveal = document.querySelector<HTMLElement>(".settings-reveal");
		expect(reveal?.inert).toBe(false);
		expect(reveal?.dataset.open).toBe("true");
	});

	it("clamps out-of-range stored values instead of rendering them", async () => {
		setup({ mode: "dim", dimOpacity: 5 });
		await waitFor(() => expect(dimSlider()).toBeTruthy());

		// 5 is a corrupt value (the slider allows 0.05–1); the loader clamps it.
		expect(Number(dimSlider().value)).toBeLessThanOrEqual(1);
		expect(Number(dimSlider().min)).toBeGreaterThan(0);
	});
});

describe("Jev second pass settings", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("refuses to switch on without an API key, and asks for no permission", async () => {
		const chrome = installChromeMock({ sync: { [SETTINGS_KEY]: DEFAULTS } });
		render(<SettingsApp activeSection="experimental" />);

		const toggle = await screen.findByRole("switch", {
			name: copy("ai_filter_enable"),
		});
		fireEvent.click(toggle);

		await waitFor(() =>
			expect(document.body.textContent).toContain(
				copy("ai_filter_key_required"),
			),
		);
		// Asking for the origin would open a permission prompt for a switch that
		// cannot work without a key — and that prompt tears the page down.
		expect(chrome.requestedOrigins).toHaveLength(0);
		expect(chrome.writes.sync).toHaveLength(0);
	});

	it("requests the API origin only when a key exists", async () => {
		const chrome = installChromeMock({
			sync: { [SETTINGS_KEY]: DEFAULTS },
			local: {
				[AI_SECRETS_KEY]: { byProvider: { typesafe: { apiKey: "ts_live" } } },
			},
		});
		render(<SettingsApp activeSection="experimental" />);

		const toggle = await screen.findByRole("switch", {
			name: copy("ai_filter_enable"),
		});
		fireEvent.click(toggle);

		await waitFor(() => expect(chrome.requestedOrigins).toHaveLength(1));
		await waitFor(() => {
			const writes = chrome.writes.sync.flatMap((write) =>
				Object.entries(write),
			);
			expect(writes).toContainEqual([
				SETTINGS_KEY,
				expect.objectContaining({ aiFilterEnabled: true }),
			]);
		});
	});

	it("shows the cached connection result as a dot on the provider row", async () => {
		installChromeMock({
			sync: { [SETTINGS_KEY]: DEFAULTS },
			local: {
				[AI_PROVIDER_TEST_KEY]: {
					typesafe: { ok: false, at: 1, detail: "http-401" },
				},
			},
		});
		render(<SettingsApp activeSection="ai-models" />);

		const dot = await screen.findByRole("img", {
			name: copy("ai_model_test_failed"),
		});
		expect(dot.getAttribute("title")).toContain("http-401");
	});

	it("marks a provider that was never tested", async () => {
		installChromeMock({ sync: { [SETTINGS_KEY]: DEFAULTS } });
		render(<SettingsApp activeSection="ai-models" />);

		expect(
			await screen.findByRole("img", { name: copy("ai_model_test_untested") }),
		).toBeTruthy();
	});

	it("portals the Jev model menu so the settings panel cannot clip it", async () => {
		installChromeMock({ sync: { [SETTINGS_KEY]: DEFAULTS } });
		render(<SettingsApp activeSection="experimental" />);

		const trigger = await screen.findByRole("button", {
			name: copy("ai_filter_model"),
		});
		fireEvent.click(trigger);

		const listbox = await screen.findByRole("listbox");
		// Settings panels clip their contents, so a menu nested inside one gets
		// cut off (or shifts the panel's height). It has to live on body.
		expect(listbox.parentElement).toBe(document.body);
		expect(listbox.style.position).toBe("fixed");

		fireEvent.keyDown(listbox, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
	});

	it("never writes the API key to the settings that sync", async () => {
		const chrome = installChromeMock({ sync: { [SETTINGS_KEY]: DEFAULTS } });
		render(<SettingsApp activeSection="ai-models" />);

		// The form only exists inside the dialog, so open the provider first.
		fireEvent.click(
			(
				await screen.findAllByRole("button", { name: copy("ai_model_edit") })
			)[0],
		);
		const input = await screen.findByPlaceholderText("ts_…");
		fireEvent.change(input, { target: { value: "ts_secret_value" } });
		fireEvent.click(
			screen.getByRole("button", { name: copy("ai_model_save") }),
		);

		await waitFor(() =>
			expect(chrome.writes.local.some((write) => AI_SECRETS_KEY in write)).toBe(
				true,
			),
		);
		expect(JSON.stringify(chrome.writes.sync)).not.toContain("ts_secret_value");
	});

	it("masks a stored key until the user reveals it", async () => {
		installChromeMock({
			sync: { [SETTINGS_KEY]: DEFAULTS },
			local: {
				[AI_SECRETS_KEY]: { byProvider: { typesafe: { apiKey: "ts_live" } } },
			},
		});
		render(<SettingsApp activeSection="ai-models" />);

		// The list reports whether a key exists without printing it.
		expect(await screen.findByText(copy("ai_model_key_set"))).toBeTruthy();

		fireEvent.click(
			(
				await screen.findAllByRole("button", { name: copy("ai_model_edit") })
			)[0],
		);
		const input = (await screen.findByPlaceholderText(
			"ts_…",
		)) as HTMLInputElement;
		await waitFor(() => expect(input.value).toBe("ts_live"));
		expect(input.type).toBe("password");

		fireEvent.click(
			screen.getByRole("button", { name: copy("ai_filter_key_show") }),
		);

		await waitFor(() => expect(input.type).toBe("text"));
	});
});

describe("debug log panel", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("stays unmounted while debug logging is off", () => {
		installChromeMock({ sync: { [SETTINGS_KEY]: DEFAULTS } });
		render(<SettingsApp activeSection="advanced" />);

		expect(document.querySelector(".debug-log-viewport")).toBeNull();
	});

	it("mounts once debug logging is on", async () => {
		installChromeMock({
			sync: { [SETTINGS_KEY]: { ...DEFAULTS, debugLogging: true } },
			local: { "debug-log": [] },
		});
		render(<SettingsApp activeSection="advanced" />);

		await waitFor(() =>
			expect(document.querySelector(".debug-log-viewport")).not.toBeNull(),
		);
	});

	it("disables clearing while there is nothing logged", async () => {
		installChromeMock({
			sync: { [SETTINGS_KEY]: { ...DEFAULTS, debugLogging: true } },
			local: { [DEBUG_LOG_KEY]: [] },
		});
		render(<SettingsApp activeSection="advanced" />);

		const clear = (await screen.findByRole("button", {
			name: copy("debug_log_clear"),
		})) as HTMLButtonElement;

		// Nothing to clear: the button must not look actionable.
		expect(clear.disabled).toBe(true);
	});

	it("asks the worker to clear a log that has entries", async () => {
		const entry: DebugLogEntry = {
			id: "session:1",
			timestamp: 1,
			sessionId: "session",
			level: "info",
			event: "content.initialized",
			context: { path: "/home" },
			details: {},
		};
		const chrome = installChromeMock({
			sync: { [SETTINGS_KEY]: { ...DEFAULTS, debugLogging: true } },
			local: { [DEBUG_LOG_KEY]: [entry] },
		});
		render(<SettingsApp activeSection="advanced" />);

		const clear = (await screen.findByRole("button", {
			name: copy("debug_log_clear"),
		})) as HTMLButtonElement;
		await waitFor(() => expect(clear.disabled).toBe(false));

		fireEvent.click(clear);

		await waitFor(() =>
			expect(chrome.messages).toContainEqual(
				expect.objectContaining({ type: "BLUENOISE_DEBUG_CLEAR" }),
			),
		);
	});
});
