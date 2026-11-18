import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const compiled = ts.transpileModule(await readFile(new URL("../src/lib/sunlight.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
const { sunPosition, solarAltitude, nightShade, renderNightMask } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, wanted ${expected} ± ${tolerance}`);

test("the sun is over the right place at known moments", () => {
	// June solstice 2024 (20:51 UTC): over the Tropic of Cancer, at about 20:51 UTC the sun is near longitude -123 + ... (12:00 UTC is over about 0)
	const june = sunPosition(new Date("2024-06-21T12:00:00Z"));
	near(june.declination, 23.43, 0.15, "solstice declination");
	near(june.longitude, 0, 3, "noon UTC is over Greenwich, within the equation of time");
	// December solstice: the Tropic of Capricorn.
	near(sunPosition(new Date("2024-12-21T12:00:00Z")).declination, -23.43, 0.15, "december declination");
	// March equinox 2024 (03:06 UTC): over the equator.
	near(sunPosition(new Date("2024-03-20T03:06:00Z")).declination, 0, 0.3, "equinox declination");
	// Six hours later the sun has moved a quarter of the way round to the west.
	const later = sunPosition(new Date("2024-06-21T18:00:00Z"));
	near(((later.longitude - june.longitude + 540) % 360) - 180, -90, 2, "six hours is 90 degrees west");
	// 03:40 UTC (a late afternoon in New Zealand in November): the sun is over about 125 East.
	near(sunPosition(new Date("2025-11-18T03:40:00Z")).longitude, 125 - 0.4, 6, "sun over Asia at 03:40 UTC");
});

test("altitude: 90 under the sun, negative on the far side, zero at the terminator", () => {
	const sun = { declination: 10, longitude: 30 };
	near(solarAltitude(10, 30, sun), 90, 0.001, "directly under the sun");
	near(solarAltitude(-10, -150, sun), -90, 0.001, "directly opposite");
	near(solarAltitude(0, 120, sun), 0, 0.5 + 10, "90 degrees away along the equator is about the horizon");
	assert.ok(solarAltitude(40, 10, sun) > 0 && solarAltitude(40, 200, sun) < 0);
});

test("the shade is clear by day, deep at night and warm only at the edge", () => {
	assert.equal(nightShade(40)[3], 0);
	assert.ok(nightShade(5)[3] <= 2); // effectively clear
	const night = nightShade(-40);
	assert.ok(night[3] > 165 && night[3] <= 178, `night opacity ${night[3]}`);
	assert.ok(night[2] > night[0], "night is blue");
	const dusk = nightShade(-1.5);
	assert.ok(dusk[0] > night[0] + 20, "the terminator glows warm");
	// Darkness grows steadily as the sun sinks.
	let last = -1;
	for (let alt = 3; alt >= -20; alt -= 1) { const a = nightShade(alt)[3]; assert.ok(a >= last - 6, `opacity should not fall as the sun sinks (${alt})`); last = Math.max(last, a); }
});

test("the whole-Earth picture is lit on one side and dark on the other", () => {
	const size = 128;
	const sun = { declination: 0, longitude: 0 };
	const mask = renderNightMask(sun, size);
	assert.equal(mask.length, size * size * 4);
	const alphaAt = (lon, row) => mask[(row * size + Math.floor(((lon + 180) / 360) * size)) * 4 + 3];
	const equator = size / 2;
	assert.equal(alphaAt(0, equator), 0); // under the sun
	assert.ok(alphaAt(180 - 2, equator) > 165); // midnight
	assert.ok(alphaAt(-60, equator) === 0 && alphaAt(60, equator) === 0); // still day
	assert.ok(alphaAt(-150, equator) > 130 && alphaAt(150, equator) > 130);
});
