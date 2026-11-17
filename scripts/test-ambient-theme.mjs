import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const compiled = ts.transpileModule(
	await readFile(
		new URL("../src/lib/ambientTheme.ts", import.meta.url),
		"utf8",
	),
	{
		compilerOptions: {
			module: ts.ModuleKind.ESNext,
			target: ts.ScriptTarget.ES2021,
		},
	},
).outputText;
const ambient = await import(
	`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const { solarElevation, ambientAppearance } = ambient;
const chch = [172.60685, -43.45389];
const noon = new Date("2026-10-08T00:00:00Z");
const midnight = new Date("2026-10-08T12:00:00Z");
const rain = {
	temp: 12,
	code: 63,
	cloudCover: 95,
	precipitation: 2,
	observedAt: noon.getTime(),
};
test("Christchurch uses geographic daylight rather than UTC clock hours", () => {
	assert.ok(solarElevation(noon, chch) > 45);
	assert.equal(ambientAppearance(noon, chch, null).mode, "light");
	assert.equal(ambientAppearance(midnight, chch, null).period, "night");
	assert.equal(ambientAppearance(midnight, chch, null).mode, "dark");
});
test("seasons and opposite hemispheres change solar elevation", () => {
	assert.ok(
		solarElevation(new Date("2026-12-21T00:00:00Z"), chch) >
			solarElevation(new Date("2026-06-21T00:00:00Z"), chch) + 35,
	);
	assert.ok(solarElevation(new Date("2026-06-21T12:00:00Z"), [0, 70]) > 40);
});
test("fresh fog darkens daylight, stale fog falls back to solar timing", () => {
	assert.equal(
		ambientAppearance(noon, chch, { ...rain, code: 45 }).reason,
		"Fog",
	);
	assert.equal(
		ambientAppearance(noon, chch, { ...rain, code: 45 }).mode,
		"dark",
	);
	assert.equal(
		ambientAppearance(noon, chch, {
			...rain,
			code: 45,
			observedAt: noon.getTime() - 31 * 60000,
		}).mode,
		"light",
	);
});
test("rain does not darken a bright midday but low sun under heavy cloud does", () => {
	assert.equal(ambientAppearance(noon, chch, rain).mode, "light");
	const evening = new Date("2026-10-08T05:00:00Z");
	assert.equal(
		ambientAppearance(evening, chch, { ...rain, observedAt: evening.getTime() })
			.reason,
		"Rain and heavy cloud",
	);
	assert.equal(
		ambientAppearance(evening, chch, { ...rain, observedAt: evening.getTime() })
			.mode,
		"dark",
	);
});
test("civil twilight distinguishes dawn from dusk and retains mode in daylight deadband", () => {
	let foundDawn = false,
		foundDusk = false,
		foundDeadband = false;
	for (let minute = 0; minute < 1440; minute++) {
		const date = new Date(noon.getTime() + minute * 60000);
		const elevation = solarElevation(date, chch);
		const appearance = ambientAppearance(date, chch, null);
		if (elevation > -6 && elevation < 0) {
			foundDawn ||= appearance.period === "dawn";
			foundDusk ||= appearance.period === "dusk";
		}
		if (elevation > 0 && elevation < 1) {
			foundDeadband = true;
			assert.equal(ambientAppearance(date, chch, null, "light").mode, "light");
			assert.equal(ambientAppearance(date, chch, null, "dark").mode, "dark");
		}
	}
	assert.ok(foundDawn && foundDusk && foundDeadband);
});

test("manual dawn, day, dusk and night choices, and older saved values", () => {
	const { parsePreference, paletteFor, THEME_PREFERENCES } = ambient;
	assert.deepEqual(THEME_PREFERENCES, ["auto", "dawn", "day", "dusk", "night"]);
	assert.equal(parsePreference("light"), "day");
	assert.equal(parsePreference("dark"), "night");
	assert.equal(parsePreference("dusk"), "dusk");
	assert.equal(parsePreference("nonsense"), "auto");
	assert.equal(parsePreference(null), "auto");
	assert.equal(paletteFor("day"), "light");
	for (const period of ["dawn", "dusk", "night"]) assert.equal(paletteFor(period), "dark");
});
