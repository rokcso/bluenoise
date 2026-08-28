import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(
	new URL("../entrypoints/popup/App.tsx", import.meta.url),
	"utf8",
);
const styles = readFileSync(
	new URL("../entrypoints/popup/style.css", import.meta.url),
	"utf8",
);

describe("debug log panel", () => {
	it("only mounts the panel while debug logging is enabled", () => {
		expect(app).toContain(
			"<AnimatedDebugLogPanel visible={config.debugLogging} />",
		);
		expect(app).toContain("<DebugLogPanel />");
	});

	it("renders the panel outside the debug logging settings card", () => {
		expect(app).toMatch(
			/<\/SettingsPanel>\s*<AnimatedDebugLogPanel visible=\{config\.debugLogging\} \/>/,
		);
	});

	it("animates both mounting and unmounting the panel", () => {
		expect(app).toContain('visible ? "is-entering" : "is-exiting"');
		expect(app).toContain("onAnimationEnd=");
		expect(styles).toContain("@keyframes debug-log-enter");
		expect(styles).toContain("@keyframes debug-log-exit");
	});

	it("offers clear and JSONL download actions", () => {
		expect(app).toContain('type: "BLUENOISE_DEBUG_CLEAR"');
		expect(app).toContain('type: "application/x-ndjson;charset=utf-8"');
	});

	it("uses a bounded scrolling viewport", () => {
		expect(styles).toContain(".debug-log-viewport");
		expect(styles).toContain("height: 340px;");
		expect(styles).toContain("overflow: auto;");
	});
});
