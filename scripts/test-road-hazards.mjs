import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compile = async (file, swap = s => s) => ts.transpileModule(swap(await readFile(new URL(`../src/lib/${file}`, import.meta.url), "utf8")), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
const dataUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const locateUrl = dataUrl(await compile("routeLocate.ts"));
const hazards = await import(dataUrl(await compile("roadHazards.ts", s => s.replace('"./routeLocate"', JSON.stringify(locateUrl)))));
const { buildRouteAlerts } = await import(dataUrl(await compile("routeAlerts.ts")));
const { cumulativeMeters } = await import(locateUrl);

// A straight 10 km road heading north from the equator (about 0.0009 degrees per 100 m).
const coords = Array.from({ length: 101 }, (_, i) => [172.6, i * 0.0009]);
const meters = cumulativeMeters(coords);

test("parses cameras, red light cameras, crossings and hazards, and skips junk", () => {
	const parsed = hazards.parseOverpass({ elements: [
		{ type: "node", id: 1, lat: 0.1, lon: 172.6, tags: { highway: "speed_camera", maxspeed: "60" } },
		{ type: "node", id: 2, lat: 0.1, lon: 172.6, tags: { enforcement: "traffic_signals" } },
		{ type: "node", id: 3, lat: 0.1, lon: 172.6, tags: { railway: "level_crossing" } },
		{ type: "node", id: 4, lat: 0.1, lon: 172.6, tags: { hazard: "damaged_road" } },
		{ type: "node", id: 5, lat: 0.1, lon: 172.6, tags: { highway: "bus_stop" } },
		{ type: "node", id: 6, tags: { highway: "speed_camera" } },
	] });
	assert.deepEqual(parsed.map(h => h.kind), ["speed_camera", "red_light_camera", "level_crossing", "hazard"]);
	assert.equal(parsed[0].maxspeed, "60");
	assert.deepEqual(hazards.parseOverpass(null), []);
});

test("keeps only hazards on the route, in order, without doubles", () => {
	const mk = (id, lat, lon = 172.6, kind = "speed_camera") => ({ id, kind, coords: [lon, lat], label: "Speed camera" });
	const found = hazards.hazardsOnRoute([mk("far", 0.045, 172.61), mk("b", 0.045), mk("a", 0.018), mk("dup", 0.0181)], coords, meters);
	assert.deepEqual(found.map(h => h.id), ["a", "b"]);
	assert.equal(found[0].index, 20);
});

test("long routes are queried in several boxes and the query names every tag", () => {
	const boxes = hazards.routeBoxes(coords, meters);
	assert.equal(boxes.length, 1); // 10 km fits one chunk
	const long = Array.from({ length: 501 }, (_, i) => [172.6, i * 0.0009]); // 50 km
	assert.equal(hazards.routeBoxes(long, cumulativeMeters(long)).length, 3);
	const query = hazards.buildOverpassQuery(boxes);
	for (const tag of ["speed_camera", "traffic_signals", "level_crossing", '"hazard"']) assert.ok(query.includes(tag));
});

test("a camera becomes an alert only when it is close, and only once passed it is gone", () => {
	const camera = { id: "n1", kind: "speed_camera", label: "Speed camera", index: 30, maxspeed: "50" };
	assert.deepEqual(buildRouteAlerts({ meters, position: 0, hazards: [camera] }), []); // 3 km away
	const [alert] = buildRouteAlerts({ meters, position: 20, hazards: [camera] });
	assert.equal(alert.kind, "camera");
	assert.equal(alert.detail, "1.0 km ahead · 50");
	assert.deepEqual(buildRouteAlerts({ meters, position: 31, hazards: [camera] }), []);
	const [crossing] = buildRouteAlerts({ meters, position: 28, hazards: [{ ...camera, kind: "level_crossing", label: "Railway crossing" }] });
	assert.equal(crossing.kind, "hazard");
});
