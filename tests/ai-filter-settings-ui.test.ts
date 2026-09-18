import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(
	new URL("../entrypoints/popup/App.tsx", import.meta.url),
	"utf8",
);
const options = readFileSync(
	new URL("../entrypoints/options/main.tsx", import.meta.url),
	"utf8",
);
const content = readFileSync(
	new URL("../entrypoints/content.ts", import.meta.url),
	"utf8",
);
const background = readFileSync(
	new URL("../entrypoints/background.ts", import.meta.url),
	"utf8",
);

describe("experimental Jev settings", () => {
	it("adds an Experimental tab to the settings navigation", () => {
		expect(options).toContain('id: "experimental"');
		expect(app).toContain('activeSection === "experimental"');
		expect(app).toContain("<AiSecondPass config={config} update={update} />");
	});

	it("keeps the API key out of anything that syncs or gets exported", () => {
		expect(app).toMatch(/chrome\.storage\.local\.set\(\{\s*\[AI_SECRETS_KEY\]/);
		// update() persists to storage.sync; the key must never travel through it.
		expect(app).not.toMatch(/update\(\{[^}]*apiKey/);
		expect(app).not.toMatch(/[Aa]piKey[^)]*RULE_DATA_KEY/);
	});

	it("requests the API origin at runtime rather than at install", () => {
		expect(app).toMatch(
			/chrome\.permissions\s*\.request\(\{ origins: \[AI_PROVIDER\.origin\] \}\)/,
		);
	});

	it("reads the key in the worker, never in the page-facing script", () => {
		expect(background).toMatch(/chrome\.storage\.local\.get\(AI_SECRETS_KEY\)/);
		expect(content).not.toContain("AI_SECRETS_KEY");
	});

	it("routes a Jev verdict through the same marking pipeline as a rule hit", () => {
		expect(content).toMatch(/applyMark\(article, AI_HIT, reason\)/);
		expect(content).toMatch(
			/state\.set\(article, \{ \.\.\.cached, hit: AI_HIT, reason, log: null \}\)/,
		);
	});
});
