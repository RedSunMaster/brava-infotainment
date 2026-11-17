import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
function load(name, routing = {}, overrides = {}) {
 const path = name.endsWith(".ts") ? name : fileURLToPath(new URL(`../src/hooks/${name}.ts`, import.meta.url));
 const source = readFileSync(path, "utf8");
 const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
 const module = { exports: {} };
 new Function("require", "module", "exports", compiled)(name => overrides[name] ?? (name === "../lib/routing" ? routing : name.startsWith(".") ? load(resolve(dirname(path), name + ".ts"), routing, overrides) : require(name)), module, module.exports);
 return module.exports;
}
function mount(callback) {
 let value;
 function Probe() { value = callback(); return null; }
 renderToStaticMarkup(React.createElement(Probe));
 return value;
}
const coords = [[172, -43], [172.02, -43]];

test("passed route fades while the remaining line starts between vertices", () => {
 const sources = new Map(), layers = new Map();
 let uploads = 0;
 const map = {
  isStyleLoaded: () => true,
  getSource: id => sources.get(id), getLayer: id => layers.get(id),
  addSource: (id, source) => sources.set(id, { ...source, setData(data) { uploads++; this.data = data; } }),
  addLayer: layer => layers.set(layer.id, layer),
  setPaintProperty: (id, key, value) => { layers.get(id).paint[key] = value; },
  removeLayer: id => layers.delete(id), removeSource: id => sources.delete(id),
 };
 const { useRoute } = load("useRoute");
 const route = mount(() => useRoute({ current: map }));
 route.applyRoute({ coords, maneuvers: [] });
 route.trimRouteByDistance(500);
 const progress = layers.get("route").paint["line-trim-offset"][1];
 assert.ok(progress > 0 && progress < 1);
 assert.deepEqual(sources.get("route").data.geometry.coordinates, coords);
 assert.match(layers.get("route").paint["line-trim-color"], /0\.12\)/);
 assert.ok(layers.get("route").paint["line-trim-fade-range"][1] > 0);
 const { validate: validateStyle } = require("mapbox-gl/dist/style-spec/index.cjs");
 assert.deepEqual(validateStyle({ version: 8, sources: { route: { type: "geojson", data: sources.get("route").data, lineMetrics: true } }, layers: [layers.get("route")] }), []);
 assert.equal(uploads, 0, "progress must not re-upload route geometry");
 layers.clear(); sources.clear();
 route.drawRoute(coords);
 assert.equal(layers.get("route").paint["line-trim-offset"][1], progress, "style restoration retains progress");
 route.trimRouteByDistance(10000);
 assert.deepEqual(layers.get("route").paint["line-trim-offset"], [0, 1]);
 route.clearRoute();
 assert.equal(sources.size, 0);
});

test("native progress handles variable latitude and repeated vertices; traffic uses projected positions", () => {
 const { routeLineMetrics, routeLineProgress, trafficGradient } = load(fileURLToPath(new URL("../src/lib/routeLine.ts", import.meta.url)));
 const metrics = routeLineMetrics([[172, -40], [172, -40], [172, -41], [172, -45]]);
 assert.equal(routeLineProgress(metrics, 0), 0);
 assert.equal(routeLineProgress(metrics, Infinity), 1);
 assert.ok(Math.abs(routeLineProgress(metrics, metrics.meters[2]) - metrics.projected[2] / metrics.projected[3]) < 1e-10);
 assert.equal(routeLineProgress(routeLineMetrics([[172, -43], [172, -43]]), 10), 0);
 const gradient = trafficGradient([0, 1, 2, 3, 4], ["low", "moderate", "heavy", "unknown"], "#123456");
 assert.deepEqual(gradient, ["step", ["line-progress"], "#123456", .25, "#f59e0b", .5, "#ef4444", .75, "#123456"]);
 assert.equal(trafficGradient([0, 1], undefined, "#123456"), "#123456");
});

test("alternative routes draw behind the selected route and clear when navigation starts", () => {
 const sources = new Map(), layers = new Map(), order = [];
 const map = {
  isStyleLoaded: () => true,
  getSource: id => sources.get(id), getLayer: id => layers.get(id),
  addSource: (id, source) => sources.set(id, { ...source, setData(data) { this.data = data; } }),
  addLayer: (layer, before) => { layers.set(layer.id, layer); order.push([layer.id, before]); },
  setPaintProperty: (id, key, value) => { layers.get(id).paint[key] = value; },
  removeLayer: id => layers.delete(id), removeSource: id => sources.delete(id),
 };
 const route = mount(() => load("useRoute").useRoute({ current: map }));
 const alternate = [[172,-43], [172.01,-43.01], [172.02,-43]];
 route.drawRoute(coords);
 route.drawAlternatives([alternate]);
 assert.deepEqual(order.at(-1), ["route-alternatives", "route"]);
 assert.equal(layers.get("route-alternatives").paint["line-color"], "#747d87");
 assert.deepEqual(sources.get("route-alternatives").data.features[0].geometry.coordinates, alternate);
 route.drawAlternatives([]);
 assert.equal(layers.has("route-alternatives"), false);
 assert.ok(layers.has("route"));
});

test("style reload restores route and traffic after terrain finishes loading, with listener cleanup", () => {
 const effects = [], listeners = new Map(), sources = new Map(), layers = new Map();
 let ready = true;
 const map = {
  isStyleLoaded: () => ready,
  getSource: id => sources.get(id), getLayer: id => layers.get(id),
  addSource: (id, value) => sources.set(id, { ...value, setData(data) { this.data = data; } }),
  addLayer: layer => layers.set(layer.id, layer),
  setPaintProperty: (id, key, value) => { layers.get(id).paint[key] = value; },
  on: (name, cb) => listeners.set(name, cb), off: name => listeners.delete(name),
 };
 const { useRoute } = load("useRoute", {}, {
  react: { useRef: current => ({ current }), useState: initial => [initial, () => {}], useEffect: effect => effects.push(effect) },
  "@mui/material": { useTheme: () => ({ palette: { primary: { main: "#123456" } } }), alpha: require("@mui/material").alpha },
 });
 const route = useRoute({ current: map });
 const cleanups = effects.map(effect => effect());
 route.applyRoute({ coords: [...coords, [172.03,-43]], maneuvers: [], congestion: ["low", "heavy"] });
 route.trimRouteByDistance(500);
 const before = structuredClone(layers.get("route").paint);
 const { validate } = require("mapbox-gl/dist/style-spec/index.cjs");
 assert.deepEqual(validate({ version: 8, sources: { route: { type: "geojson", data: sources.get("route").data, lineMetrics: true } }, layers: [layers.get("route")] }), []);
 ready = false; layers.clear(); sources.clear(); listeners.get("style.load")();
 assert.equal(layers.size, 0);
 ready = true; listeners.get("sourcedata")();
 assert.deepEqual(layers.get("route").paint, before);
 cleanups.forEach(cleanup => cleanup());
 assert.equal(listeners.size, 0);
});

test("alternative route restores after a loading delay", () => {
 const effects = [], listeners = new Map(), sources = new Map(), layers = new Map(); let ready = true;
 const map = { isStyleLoaded: () => ready, getSource: id => sources.get(id), getLayer: id => layers.get(id), addSource: (id, source) => sources.set(id, { ...source, setData(data) { this.data = data; } }), addLayer: layer => layers.set(layer.id, layer), setPaintProperty: (id,key,value) => { layers.get(id).paint[key] = value; }, removeLayer: id => layers.delete(id), removeSource: id => sources.delete(id), on: (name, fn) => listeners.set(name,fn), off: name => listeners.delete(name) };
 const { useRoute } = load("useRoute", {}, { react: { useRef: current => ({ current }), useState: initial => [initial, () => {}], useEffect: fn => effects.push(fn) }, "@mui/material": { useTheme: () => ({ palette: { primary: { main: "#123456" } } }), alpha: require("@mui/material").alpha } });
 const route = useRoute({ current: map }); const cleanup = effects.map(fn => fn());
 route.drawRoute(coords); ready = false; route.drawAlternatives([coords]); assert.equal(layers.has("route-alternatives"), false);
 ready = true; listeners.get("sourcedata")(); assert.equal(layers.has("route-alternatives"), true);
 cleanup.forEach(fn => fn());
});

test("traffic timing refresh preserves progress and rejects mismatched manoeuvres", () => {
 const { useRoute } = load("useRoute");
 const map = { isStyleLoaded: () => false };
 const route = mount(() => useRoute({ current: map }));
 const step = { type: "turn", begin_shape_index: 0, time: 10, length: 1, instruction: "Turn" };
 route.applyRoute({ coords, maneuvers: [step] });
 assert.equal(route.refreshTimings({ coords, maneuvers: [{ ...step, time: 25 }] }), true);
 assert.equal(route.maneuversRef.current[0].time, 25);
 assert.equal(route.coordsRef.current, coords);
 assert.equal(route.refreshTimings({ coords, maneuvers: [{ ...step, begin_shape_index: 1, time: 50 }] }), false);
 assert.equal(route.maneuversRef.current[0].time, 25);
});

test("destination highlight only selects a containing footprint, excluding courtyard holes", () => {
 const { containsDestination } = load("useDestinationHighlight");
 const polygon = { type: "Polygon", coordinates: [[[0,0],[4,0],[4,4],[0,4],[0,0]], [[1,1],[2,1],[2,2],[1,2],[1,1]]] };
 assert.equal(containsDestination(polygon, [3,3]), true);
 assert.equal(containsDestination(polygon, [1.5,1.5]), false);
 assert.equal(containsDestination(polygon, [5,3]), false);
 assert.equal(containsDestination({ type: "MultiPolygon", coordinates: [polygon.coordinates] }, [3,3]), true);
});

test("on-course mid-segment GPS does not reroute; a moving deviation does, with cooldown", async () => {
 let reroutes = 0, matchingCalls = 0;
 const { useNavigation } = load("useNavigation", { snapToRoad: async trail => { matchingCalls++; return trail.at(-1); } });
 const nav = mount(() => useNavigation({ current: null }, { current: [] }, { current: coords }, { current: 0 }, () => reroutes++));
 await nav.onPositionUpdate([172.01, -43], 90, 10, "mapbox");
 assert.equal(reroutes, 0);
 assert.equal(matchingCalls, 1);
 await nav.onPositionUpdate([172.01, -43.001], 90, 0, "mapbox");
 assert.equal(reroutes, 0);
 await nav.onPositionUpdate([172.01, -43.001], 90, 10, "mapbox");
 assert.equal(reroutes, 1);
 const calls = matchingCalls;
 await nav.onPositionUpdate([172.01, -43.002], 90, 10, "mapbox");
 assert.equal(reroutes, 1);
 assert.equal(matchingCalls, calls, "off-route detection must not wait for map matching");
});

test("failed route requests preserve the existing route", async () => {
 const { useRoute } = load("useRoute", { getRoute: async () => { throw new Error("offline"); } });
 const route = mount(() => useRoute({ current: { isStyleLoaded: () => false } }));
 route.applyRoute({ coords, maneuvers: [] });
 await assert.rejects(route.fetchRoute(coords[0], coords[1], "mapbox"), /offline/);
 assert.equal(route.coordsRef.current, coords);
});

test("route sampling keeps ends and bounds the point count for URL-based searches", () => {
 const { sampleRoute } = load(fileURLToPath(new URL("../src/lib/routeLine.ts", import.meta.url)));
 const long = Array.from({ length: 2104 }, (_, i) => [172 + i * 0.0004, -43 - i * 0.0006]);
 const sampled = sampleRoute(long, 150);
 assert.ok(sampled.length <= 150 && sampled.length > 100);
 assert.deepEqual(sampled[0], long[0]);
 assert.deepEqual(sampled[sampled.length - 1], long[long.length - 1]);
 const short = [[172, -43], [172.1, -43.1]];
 assert.equal(sampleRoute(short, 150), short);
 assert.deepEqual(sampleRoute([[172, -43], [172, -43], [172, -43]], 2), [[172, -43], [172, -43]]);
});

test("look-ahead camera zooms out with speed, in for turns, and glides between values", () => {
 const { lookAheadCamera, smoothToward, isSignificantTurn, turnProximity } = load(fileURLToPath(new URL("../src/lib/cameraLookAhead.ts", import.meta.url)));
 const city = lookAheadCamera({ speedMs: 13.9, distanceToNextM: 1000 });
 const motorway = lookAheadCamera({ speedMs: 28, distanceToNextM: 5000 });
 const crawl = lookAheadCamera({ speedMs: 1, distanceToNextM: null });
 assert.ok(Math.abs(city.zoom - 16.5) < 0.05, "50 km/h keeps the usual zoom");
 assert.ok(motorway.zoom < city.zoom - 0.8, "motorway speed zooms out");
 assert.ok(crawl.zoom > city.zoom, "slow traffic zooms in");
 assert.ok(motorway.pitch > city.pitch, "tilts further at speed");
 const turn = lookAheadCamera({ speedMs: 13.9, distanceToNextM: 60 });
 assert.ok(turn.zoom > city.zoom + 0.3 && turn.zoom <= 17.6, "close turns zoom in, capped");
 assert.equal(lookAheadCamera({ speedMs: 13.9, distanceToNextM: 60, significantTurn: false }).zoom, city.zoom, "straight-on steps do not zoom");
 assert.equal(turnProximity(200, 13.9), 0, "at 50 km/h the camera waits until about 9 s before the turn");
 assert.ok(turnProximity(200, 28) > 0, "and starts earlier at motorway speed");
 assert.equal(isSignificantTurn({ type: "turn", modifier: "left" }), true);
 assert.equal(isSignificantTurn({ type: "continue", modifier: "straight" }), false);
 assert.equal(isSignificantTurn({ type: "new name", modifier: "straight" }), false);
 assert.equal(isSignificantTurn({ type: "roundabout", modifier: "straight" }), true);
 assert.equal(isSignificantTurn(undefined), false);
 assert.ok(turn.pitch < city.pitch, "flattens for the junction");
 assert.equal(lookAheadCamera({ speedMs: 13.9, distanceToNextM: 400 }).zoom, city.zoom);
 assert.ok(lookAheadCamera({ speedMs: NaN, distanceToNextM: NaN }).zoom > 0);
 assert.equal(smoothToward(10, 20, 0, 1000), 10);
 assert.ok(smoothToward(10, 20, 1000, 1000) > 16 && smoothToward(10, 20, 1000, 1000) < 17);
});

test("the car keeps the same on-screen size at every zoom", () => {
 const { puckModelScale } = load(fileURLToPath(new URL("../src/lib/cameraLookAhead.ts", import.meta.url)));
 const pixels = zoom => puckModelScale(zoom) * Math.pow(2, zoom); // on-screen size is world size x 2^zoom
 assert.equal(puckModelScale(16.5), 3.3, "base size at the normal follow zoom");
 for (const zoom of [14, 15.3, 16, 16.5, 17.06, 17.4, 18]) assert.ok(Math.abs(pixels(zoom) / pixels(16.5) - 1) < 1e-9, "same size at zoom " + zoom);
 assert.ok(pixels(1) < pixels(16.5) * 0.1 && pixels(25) > pixels(16.5) * 5, "stops compensating at extreme zooms");
});

test("reaching a maneuver publishes the next maneuver's distance, never 0 m next to the new instruction", async () => {
 const log = []; let hooks = 0;
 const names = ["step", "instruction", "distance", "time"];
 const react = { useRef: current => ({ current }), useState: initial => { const name = names[hooks++ % names.length]; return [initial, value => log.push([name, value])]; }, useEffect() {}, useCallback: fn => fn };
 const line = [0, 1, 2, 3, 4].map(i => [172 + i * 0.001, -43]);
 const maneuvers = [
  { begin_shape_index: 0, instruction: "Head east", length: 0.2, time: 20, type: "depart" },
  { begin_shape_index: 2, instruction: "Turn left onto A Street", length: 0.2, time: 20, type: "turn" },
  { begin_shape_index: 4, instruction: "Turn right onto B Street", length: 0.2, time: 20, type: "turn" },
 ];
 const { useNavigation } = load("useNavigation", { snapToRoad: async trail => trail.at(-1) }, { react });
 const nav = useNavigation({ current: null }, { current: maneuvers }, { current: line }, { current: 0 });
 await nav.onPositionUpdate(line[2], 90, 10, "mapbox");
 const last = name => log.filter(([key]) => key === name).at(-1)?.[1];
 assert.equal(last("step"), 1);
 assert.equal(last("instruction"), "Turn left onto A Street");
 const expected = 2 * 0.001 * 111320 * Math.cos(43 * Math.PI / 180);
 assert.ok(Math.abs(last("distance") - expected) < 2, `distance ${last("distance")} should be about ${expected.toFixed(0)} m`);
 assert.ok(log.filter(([key]) => key === "distance").every(([, value]) => value > 50), "no 0 m flash was published");
 // Skipping past two maneuvers in one update lands on the last one, with its own distance.
 const jump = [];
 hooks = 0; log.length = 0;
 const skipper = useNavigation({ current: null }, { current: maneuvers }, { current: line }, { current: 0 });
 await skipper.onPositionUpdate(line[4], 90, 10, "mapbox");
 assert.equal(last("step"), 2);
 assert.equal(last("instruction"), "Turn right onto B Street");
});
