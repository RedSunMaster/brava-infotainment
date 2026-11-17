import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import test from "node:test";
import ts from "typescript";
import polyline from "@mapbox/polyline";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/lib/mapboxDirections.ts", import.meta.url), "utf8");
function fixture(body, statusCode = 200) {
 let requested;
 const https = { get(url, callback) {
  requested = new URL(url);
  const request = new EventEmitter();
  request.setTimeout = () => request;
  queueMicrotask(() => {
   const response = new EventEmitter(); response.statusCode = statusCode;
   callback(response); response.emit("data", JSON.stringify(body)); response.emit("end");
  });
  return request;
 } };
 const module = { exports: {} };
 const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2021 } }).outputText;
 new Function("require", "module", "exports", compiled)(name => name === "https" ? https : require(name), module, module.exports);
 return { api: module.exports, url: () => requested };
}
const step = (coords, duration) => ({ geometry: polyline.encode(coords.map(([lng,lat]) => [lat,lng]), 6), distance: 100, duration, maneuver: { instruction: "Continue", type: "straight" } });

test("traffic annotations align across step and leg boundaries, with traffic-aware durations", async () => {
 const a = [172,-43], b = [172.001,-43], c = [172.002,-43], d = [172.003,-43];
 const { api, url } = fixture({ routes: [{ legs: [
  { steps: [step([a,b], 10), step([b,c], 40)], annotation: { congestion: ["low", "heavy"] } },
  { steps: [step([c,d], 20)], annotation: { congestion: ["moderate"] } },
 ] }] });
 const route = await api.getMapboxRoute(a, d, [c]);
 assert.ok(url().pathname.includes("/driving-traffic/"));
 assert.equal(url().searchParams.get("annotations"), "congestion,maxspeed,closure");
 assert.equal(url().searchParams.get("overview"), "full");
 assert.deepEqual(route.coords, [a,b,c,d]);
 assert.deepEqual(route.maneuvers.map(m => m.begin_shape_index), [0,1,2]);
 assert.deepEqual(route.congestion, ["low","heavy","moderate"]);
 assert.equal(route.maneuvers.reduce((sum,m) => sum+m.time,0), 70);
});

test("alternatives retain lanes, limits and leg-relative incident positions", async () => {
 const a = [172,-43], b = [172.001,-43], c = [172.002,-43];
 const turn = step([a,b], 10); turn.intersections = [{ lanes: [{ indications: ["left"], valid: true }] }];
 const leg = { steps: [turn, step([b,c], 20)], annotation: { congestion: ["low", "heavy"], maxspeed: [{ speed: 50, unit: "km/h" }, { unknown: true }] }, incidents: [{ id: "roadwork", description: "Road works", geometry_index_start: 1 }] };
 const { api, url } = fixture({ routes: [{ legs: [leg] }, { legs: [leg] }] });
 const routes = await api.getMapboxRoutes(a,c);
 assert.equal(url().searchParams.get("alternatives"), "true");
 assert.equal(routes.length, 2);
 assert.equal(routes[0].maneuvers[0].lanes[0].valid, true);
 assert.deepEqual(routes[0].speedLimits, [{ speed: 50, unit: "km/h" }, { unknown: true }]);
 assert.deepEqual(routes[0].incidents, [{ id: "roadwork", description: "Road works", index: 1 }]);
});

test("missing traffic remains unknown rather than being labelled clear", async () => {
 const route = await fixture({ routes: [{ legs: [{ steps: [step([[172,-43],[173,-43]], 60)] }] }] }).api.getMapboxRoute([172,-43],[173,-43]);
 assert.deepEqual(route.congestion, ["unknown"]);
});

test("rerouting includes preferences and a bounded speed-sensitive radius; closures and delay are parsed", async () => {
 const a = [172,-43], b = [172.001,-43], c = [172.002,-43];
 const { api, url } = fixture({ routes: [{ duration: 180, duration_typical: 120, legs: [{ steps: [step([a,b,c],180)], closures: [{ geometry_index_start: 1, geometry_index_end: 2 }] }] }] });
 const route = await api.getMapboxRoute(a,c,[],undefined,{ avoid: ["toll", "ferry"], speedMs: 20 });
 assert.equal(url().searchParams.get("exclude"), "toll,ferry");
 assert.equal(url().searchParams.get("avoid_maneuver_radius"), "160");
 assert.equal(route.trafficDelaySeconds, 60);
 assert.deepEqual(route.closures, [{ start: 1, end: 2 }]);
});

test("destination targets and junction images survive route parsing", async () => {
 const a = [172,-43], b = [172.001,-43], c = [172.002,-43];
 const first = step([a,b], 20);
 first.bannerInstructions = [{ distanceAlongGeometry: 250, view: { components: [{ type: "guidance-view", imageUrl: "https://example.com/junction.png" }] } }];
 const { api, url } = fixture({ routes: [{ legs: [{ steps: [first] }, { steps: [step([b,c], 20)] }] }] });
 const [route] = await api.getMapboxRoutes(a,c,[b],true,[172.0021,-43.0001]);
 assert.equal(url().searchParams.get("waypoint_targets"), ";;172.0021,-43.0001");
 assert.deepEqual(route.maneuvers[0].junctions, [{ distance: 250, url: "https://example.com/junction.png" }]);
});

test("routing errors reject rather than replacing a route with empty data", async () => {
 await assert.rejects(fixture({}, 503).api.getMapboxRoute([172,-43],[173,-43]), /unavailable/);
 await assert.rejects(fixture({ routes: [] }).api.getMapboxRoute([172,-43],[173,-43]), /No drivable route/);
});

test("each leg's travel time is kept so the time to a stop can be told apart from the whole trip", async () => {
 const a = [172,-43], b = [172.001,-43], c = [172.002,-43];
 const { api } = fixture({ routes: [{ legs: [
  { duration: 120, steps: [step([a,b], 120)], annotation: { congestion: ["low"] } },
  { duration: 300, steps: [step([b,c], 300)], annotation: { congestion: ["low"] } },
 ] }] });
 assert.deepEqual((await api.getMapboxRoute(a, c, [b])).legSeconds, [120, 300]);
});

test("junction images built from Mapbox's base address carry density, format and token", async () => {
 process.env.MAPBOX_TOKEN = "pk.test";
 const a = [172,-43], b = [172.001,-43];
 const turn = step([a,b], 20);
 turn.bannerInstructions = [{ distanceAlongGeometry: 300, view: { components: [{ type: "guidance-view", imageBaseURL: "https://api.mapbox.com/guidance-views/v1/123/jct" }] } }];
 const { api } = fixture({ routes: [{ legs: [{ steps: [turn] }] }] });
 const [route] = await api.getMapboxRoutes(a, b);
 assert.equal(route.maneuvers[0].junctions.length, 1);
 const { url } = route.maneuvers[0].junctions[0];
 assert.match(url, /^https:\/\/api\.mapbox\.com\/guidance-views\/v1\/123\/jct@2x\.png\?access_token=pk.test$/);
});
