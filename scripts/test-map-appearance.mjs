import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const compiled = ts.transpileModule(await readFile(new URL("../src/lib/mapStyle.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { applyMapAppearance, MAP_STYLE } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
const now = Date.now();
const weather = { temp: 10, code: 63, cloudCover: 90, precipitation: 2, observedAt: now };
function fixture() {
 const state = {};
 const map = { setConfigProperty: (...args) => { state.light = args; }, setRain: value => { state.rain = value; }, setSnow: value => { state.snow = value; } };
 return { state, map };
}
test("all lighting periods update the same Standard map without replacing its style", () => {
 assert.equal(MAP_STYLE, "mapbox://styles/mapbox/standard");
 const { map, state } = fixture();
 for (const period of ["day", "dusk", "night", "dawn"]) {
  applyMapAppearance(map, period, null, now);
  assert.deepEqual(state.light, ["basemap", "lightPreset", period]);
 }
});
test("rain, snow and clear conditions reset the previous effect", () => {
 const { map, state } = fixture();
 applyMapAppearance(map, "day", weather, now);
 assert.equal(state.rain.density, 0.2); assert.equal(state.snow, null);
 applyMapAppearance(map, "night", { ...weather, code: 75 }, now);
 assert.equal(state.rain, null); assert.equal(state.snow.density, 0.2);
 applyMapAppearance(map, "day", { ...weather, code: 0 }, now);
 assert.equal(state.rain, null); assert.equal(state.snow, null);
});
test("stale, future and missing weather disable precipitation", () => {
 const { map, state } = fixture();
 for (const value of [null, { ...weather, observedAt: now - 1800000 }, { ...weather, observedAt: now + 1 }]) {
  applyMapAppearance(map, "dusk", value, now);
  assert.equal(state.rain, null); assert.equal(state.snow, null);
 }
});

test("weather overrides apply without a live forecast and restore automatic weather", () => {
 const { map, state } = fixture();
 applyMapAppearance(map, "night", null, now, "rain");
 assert.equal(state.rain.density, 0.25); assert.equal(state.snow, null);
 applyMapAppearance(map, "night", weather, now, "snow");
 assert.equal(state.rain, null); assert.equal(state.snow.density, 0.25);
 applyMapAppearance(map, "day", weather, now, "clear");
 assert.equal(state.rain, null); assert.equal(state.snow, null);
 applyMapAppearance(map, "day", weather, now, "auto");
 assert.equal(state.rain.density, 0.2); assert.equal(state.snow, null);
});
