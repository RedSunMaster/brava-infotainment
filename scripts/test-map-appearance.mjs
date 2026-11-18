import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const transpile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const dataUrl = code => "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const sunlightUrl = dataUrl(transpile(await readFile(new URL("../src/lib/sunlight.ts", import.meta.url), "utf8")));
const compiled = transpile((await readFile(new URL("../src/lib/mapStyle.ts", import.meta.url), "utf8")).replace('"./sunlight"', JSON.stringify(sunlightUrl)));
const { applyMapAppearance, applyTerrain, applyTraffic, setTrafficAppearance, fogFor, weatherStrength, spaceShare, presetFor, glowLight, skyPeriod, setLightPreset, PRESET_FADE_MS, MAP_STYLE } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
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

test("weather only shows near the ground: from space the globe keeps its clear atmosphere", () => {
 assert.equal(weatherStrength(1.5), 0);
 assert.equal(weatherStrength(6), 0);
 assert.equal(weatherStrength(16.5), 1);
 assert.ok(weatherStrength(8) > 0 && weatherStrength(8) < weatherStrength(10) && weatherStrength(10) < 1);
 // A rainy day at a camera height of a globe: no weather colouring, no rain, no dimming, stars as normal.
 const filters = [];
 let zoom = 1.5, onZoom;
 const state = {};
 const canvas = { style: {} };
 const map = { getCanvas: () => canvas, getZoom: () => zoom, on: (name, handler) => { if (name === "zoom") onZoom = handler; },
  setConfigProperty: () => {}, setRain: value => { state.rain = value; }, setSnow: value => { state.snow = value; }, setFog: value => { state.fog = value; filters.push(canvas.style.filter); } };
 applyMapAppearance(map, "day", weather, now);
 // Space has stars whatever the local time, and a softer, bluer glow than the day-time haze; no weather colouring.
 const clear = fogFor("day", 0, 0);
 const spaceFog = { ...clear, "star-intensity": 0.55, color: "#87b5e7", "horizon-blend": clear["horizon-blend"] / 2 };
 assert.deepEqual(state.fog, spaceFog);
 assert.equal(state.rain, null);
 assert.equal(canvas.style.filter, "");
 // Coming down to street level brings the weather in, in steps.
 zoom = 9; onZoom();
 assert.notDeepEqual(state.fog, spaceFog);
 assert.ok(state.rain && state.rain.opacity > 0 && state.rain.opacity < 0.5);
 zoom = 16.5; onZoom();
 assert.deepEqual(state.fog, fogFor("day", 0.9, 0.15));
 assert.ok(canvas.style.filter.includes("saturate"));
 // And going back up takes it away again.
 zoom = 2; onZoom();
 assert.deepEqual(state.fog, spaceFog);
 assert.equal(canvas.style.filter, "");
});

test("the globe is lit as day with stars, and the local lighting takes over as the camera comes down", () => {
 assert.equal(spaceShare(1.5), 1);
 assert.equal(spaceShare(7), 0);
 assert.ok(spaceShare(5) > 0 && spaceShare(5) < 1);
 // Night where you are, but the globe (night layer on) is shown in daylight: the shadow layer draws its real night side.
 assert.equal(presetFor("night", 1.5, "night", true), "day");
 assert.equal(presetFor("night", 16.5, "day", true), "night");
 // Between zoom 4 and 4.6 the last choice holds, so it cannot flicker.
 assert.equal(presetFor("night", 4.3, "day", true), "day");
 assert.equal(presetFor("night", 4.3, "night", true), "night");
 assert.equal(presetFor("night", 4.8, "day", true), "night");
 // Without the night layer the preset is always the local one.
 assert.equal(presetFor("night", 1.5, "day", false), "night");
 // Through the real function: a night-time drive starts the globe in day lighting and lands in night lighting.
 let zoom = 1.5, onZoom;
 const state = {};
 const map = { getCanvas: () => ({ style: {} }), getZoom: () => zoom, on: (name, handler) => { if (name === "zoom") onZoom = handler; },
  setConfigProperty: (...args) => { state.light = args; }, setRain: () => {}, setSnow: () => {}, setFog: () => {} };
 applyMapAppearance(map, "night", weather, now);
 assert.equal(state.light[2], "day");
 zoom = 16.5; onZoom();
 assert.equal(state.light[2], "night");
 zoom = 1.5; onZoom();
 assert.equal(state.light[2], "day");
});

test("the atmosphere glow follows the sun: bright facing the day side, faint facing the night side", () => {
 const sun = { declination: 0, longitude: 0 };
 assert.equal(glowLight(0, 0, sun), 1); // under the sun
 assert.equal(glowLight(0, 180, sun), 0); // midnight
 assert.equal(glowLight(0, 90, sun) < 1 && glowLight(0, 90, sun) > 0, true); // the terminator is in between
 assert.ok(glowLight(0, 60, sun) > glowLight(0, 110, sun));
 assert.equal(glowLight(0, 180, null), 1); // night side switched off: no change
});

test("the map is lit for the time of day at the place in view, and the car's weather stays with the car", () => {
 const sun = { declination: 0, longitude: 0 };
 assert.equal(skyPeriod(0, 0, sun), "day"); // under the sun
 assert.equal(skyPeriod(0, 180, sun), "night");
 // Just after the sun has set on the afternoon side: dusk. Just before it rises on the morning side: dawn.
 assert.equal(skyPeriod(0, 90, sun), "dusk");
 assert.equal(skyPeriod(0, -90, sun), "dawn");
 assert.equal(skyPeriod(0, 45, sun), "day");
 // Presets: the view's own time of day takes over once the camera is down, and at the globe it is always day.
 assert.equal(presetFor("day", 16.5, "day", true, "night"), "night");
 assert.equal(presetFor("day", 1.5, "night", true, "night"), "day");
 assert.equal(presetFor("day", 16.5, "day", false, "night"), "night");
 // Looking at somewhere far from the car (the other side of the world) at street level: no rain, fog or dimming, whatever the car's weather.
 let center = { lat: -43, lng: 172 };
 const canvas = { style: {} };
 const state = {};
 let onCamera;
 const map = { getCanvas: () => canvas, getZoom: () => 16, getCenter: () => center, on: (name, handler) => { if (name === "zoom") onCamera = handler; },
  setConfigProperty: () => {}, setRain: value => { state.rain = value; }, setSnow: () => {}, setFog: value => { state.fog = value; } };
 applyMapAppearance(map, "day", weather, now, "auto", () => ({ anchor: [172, -43], forced: false }));
 assert.ok(state.rain, "rain over the car");
 assert.ok(canvas.style.filter.includes("saturate"));
 center = { lat: 40, lng: -100 }; onCamera();
 assert.equal(state.rain, null, "no rain over America");
 assert.equal(canvas.style.filter, "");
 center = { lat: -43.2, lng: 172.1 }; onCamera();
 assert.ok(state.rain, "back near the car, the rain returns");
 // A time of day picked by hand applies everywhere.
 center = { lat: 40, lng: -100 };
 applyMapAppearance(map, "day", weather, now, "auto", () => ({ anchor: [172, -43], forced: true }));
 assert.ok(state.rain);
});

test("changing the lighting preset fades over a couple of seconds instead of snapping", () => {
 const calls = [];
 const map = { style: { setTransition: transition => calls.push(["transition", transition.duration]) }, setConfigProperty: (...args) => calls.push(["preset", args[2]]) };
 setLightPreset(map, "night");
 // The transition is stretched first, then the preset changes, so the change is the thing that fades.
 assert.deepEqual(calls, [["transition", PRESET_FADE_MS], ["preset", "night"]]);
 assert.ok(PRESET_FADE_MS >= 1000 && PRESET_FADE_MS <= 4000);
 // The very first lighting is just there.
 calls.length = 0;
 setLightPreset(map, "day", false);
 assert.deepEqual(calls, [["preset", "day"]]);
 // A map without the transition API still changes, instantly.
 const plain = []; setLightPreset({ setConfigProperty: (...args) => plain.push(args[2]) }, "dusk");
 assert.deepEqual(plain, ["dusk"]);
});
