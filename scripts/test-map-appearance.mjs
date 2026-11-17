import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const compiled = ts.transpileModule(await readFile(new URL("../src/lib/mapStyle.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { applyMapAppearance, applyTerrain, applyTraffic, setTrafficAppearance, fogFor, MAP_STYLE } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
const now = Date.now();
const weather = { temp: 10, code: 63, cloudCover: 90, precipitation: 2, observedAt: now };
function fixture() {
 const state = {};
 const map = { getCanvas: () => ({ style: {} }), setConfigProperty: (...args) => { state.light = args; }, setRain: value => { state.rain = value; }, setSnow: value => { state.snow = value; }, setFog: value => { state.fog = value; } };
 return { state, map };
}
test("terrain is restored without duplicating its source and uses realistic elevation", () => {
 const sources = new Map();
 let terrain;
 const map = { getSource: id => sources.get(id), addSource: (id, source) => { assert.ok(!sources.has(id)); sources.set(id, source); }, setTerrain: value => { terrain = value; } };
 applyTerrain(map); applyTerrain(map);
 assert.equal(sources.size, 1);
 assert.equal(terrain.exaggeration, 1);
 assert.equal(sources.get(terrain.source).type, "raster-dem");
 sources.clear(); applyTerrain(map);
 assert.equal(sources.size, 1);
});
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
 assert.equal(state.rain.density, 0.3); assert.equal(state.snow, null);
 applyMapAppearance(map, "night", { ...weather, code: 75 }, now); // heavy snow
 assert.equal(state.rain, null); assert.equal(state.snow.density, 0.8);
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
 assert.equal(state.rain.density, 0.3); assert.equal(state.snow, null);
 applyMapAppearance(map, "night", weather, now, "snow");
 assert.equal(state.rain, null); assert.equal(state.snow.density, 0.3);
 applyMapAppearance(map, "day", weather, now, "clear");
 assert.equal(state.rain, null); assert.equal(state.snow, null);
 applyMapAppearance(map, "day", weather, now, "auto");
 assert.equal(state.rain.density, 0.3); assert.equal(state.snow, null);
});
test("live traffic is drawn on roads once, only for slow traffic, with orange and red colours", () => {
 const sources = new Map(), layers = new Map();
 const map = { getSource: id => sources.get(id), getLayer: id => layers.get(id), addSource: (id, source) => sources.set(id, source), addLayer: layer => layers.set(layer.id, layer) };
 applyTraffic(map); applyTraffic(map);
 assert.equal(sources.size, 1); assert.equal(layers.size, 1);
 const layer = layers.get("brava-traffic");
 assert.equal(sources.get("brava-traffic").url, "mapbox://mapbox.mapbox-traffic-v1");
 assert.equal(layer["source-layer"], "traffic");
 assert.deepEqual(layer.filter[2][1], ["moderate", "heavy", "severe"]);
 assert.ok(JSON.stringify(layer.paint["line-color"]).includes("#f59e0b") && JSON.stringify(layer.paint["line-color"]).includes("#ef4444"));
 sources.clear(); layers.clear(); applyTraffic(map);
 assert.equal(layers.size, 1);
});
test("fog follows the lighting preset and thickens in precipitation", () => {
 const day = fogFor("day"), night = fogFor("night"), rain = fogFor("day", 0.9, 0.15);
 assert.notEqual(day.color, night.color);
 assert.equal(day["star-intensity"], 0);
 assert.ok(night["star-intensity"] > 0.5);
 assert.ok(rain.range[1] < day.range[1] && rain["horizon-blend"] > day["horizon-blend"]);
 const { state, map } = fixture();
 applyMapAppearance(map, "dusk", { ...weather, code: 0, precipitation: 0 }, now);
 // Clear weather code, but the observation still reports 90% cloud: the sky greys, with no ground mist.
 assert.deepEqual(state.fog, fogFor("dusk", 0.9, 0));
 applyMapAppearance(map, "dusk", weather, now);
 assert.deepEqual(state.fog, fogFor("dusk", 0.9, 0.15)); // rain: cloud plus a little mist
});
test("traffic is wider on main roads, can be hidden, and fades while a route is shown", () => {
 const layers = new Map(), sources = new Map();
 const map = { getSource: id => sources.get(id), getLayer: id => layers.get(id), addSource: (id, s) => sources.set(id, s), addLayer: l => layers.set(l.id, l),
  setLayoutProperty: (id, name, value) => { layers.get(id).layout[name] = value; }, setPaintProperty: (id, name, value) => { layers.get(id).paint[name] = value; } };
 setTrafficAppearance(map, { visible: true, dimmed: false }); // no layer yet: nothing happens
 applyTraffic(map);
 const width = JSON.stringify(layers.get("brava-traffic").paint["line-width"]);
 assert.ok(width.includes('"class"') && width.includes("motorway"));
 setTrafficAppearance(map, { visible: true, dimmed: true });
 assert.equal(layers.get("brava-traffic").layout.visibility, "visible");
 assert.ok(layers.get("brava-traffic").paint["line-opacity"] < 0.5);
 setTrafficAppearance(map, { visible: false, dimmed: false });
 assert.equal(layers.get("brava-traffic").layout.visibility, "none");
 assert.equal(layers.get("brava-traffic").paint["line-opacity"], 0.9);
});
