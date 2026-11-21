import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Loads a TypeScript module from src/lib, inlining its relative imports as data URLs.
async function load(name) {
	const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
	let compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
	for (const match of compiled.matchAll(/from "\.\/(\w+)"/g)) {
		const dep = await dataUrl(match[1]);
		compiled = compiled.replace(match[0], `from "${dep}"`);
	}
	return compiled;
}
async function dataUrl(name) { return `data:text/javascript;base64,${Buffer.from(await load(name)).toString("base64")}`; }
const locate = await import(await dataUrl("routeLocate"));
const sim = await import(await dataUrl("simulationProfile"));

// A straight east-west road of `metres`, with a vertex every 20 m.
function road(metres, startLng = 172, lat = -43) {
	const perMetre = 1 / (111_320 * Math.cos((lat * Math.PI) / 180));
	return Array.from({ length: Math.floor(metres / 20) + 1 }, (_, i) => [startLng + i * 20 * perMetre, lat]);
}
function run(profile, seconds = 600, step = 0.05) {
	const samples = [];
	let distance = 0;
	for (let t = 0; t < seconds; t += step) {
		const result = sim.drive(profile, distance, step);
		distance = result.distance;
		samples.push({ t, distance, ...result.state });
		if (result.state.arrived) break;
	}
	return samples;
}

test("the car follows the posted limit, slows early for a lower one and stops at the end", () => {
	const coords = road(1000);
	const limits = coords.slice(0, -1).map((_, i) => ({ speed: i < 25 ? 80 : 30, unit: "km/h" }));
	const profile = sim.buildProfile({ coords, speedLimits: limits });
	const samples = run(profile);
	const last = samples[samples.length - 1];
	assert.ok(last.arrived, "reaches the end");
	for (const sample of samples) {
		const limit = sample.distance < 500 ? 80 / 3.6 : 30 / 3.6;
		// Never faster than the limit that applies, except while still braking towards the lower one.
		if (sample.distance < 500 - 80) assert.ok(sample.speed <= limit + 0.01, `${sample.speed} at ${sample.distance}`);
		else if (sample.distance >= 500) assert.ok(sample.speed <= limit + 0.01, `${sample.speed} at ${sample.distance}`);
	}
	const atBoundary = samples.find(sample => sample.distance >= 500);
	assert.ok(atBoundary.speed <= 30 / 3.6 + 0.05, "already down to 30 km/h when the zone starts");
	const cruising = samples.find(sample => sample.distance > 300);
	assert.ok(Math.abs(cruising.speed - 80 / 3.6) < 0.2, "cruises at the limit");
});

test("braking and acceleration stay within comfortable limits", () => {
	const coords = road(800);
	const profile = sim.buildProfile({ coords, speedLimits: coords.slice(0, -1).map((_, i) => ({ speed: i < 20 ? 60 : 20, unit: "km/h" })) });
	const samples = run(profile, 600, 0.1);
	for (let i = 1; i < samples.length - 1; i++) {
		const acceleration = (samples[i].speed - samples[i - 1].speed) / 0.1;
		assert.ok(acceleration < sim.ACCEL + 0.6 && acceleration > -sim.DECEL - 0.6, `acceleration ${acceleration} at ${samples[i].distance}`);
	}
});

test("every point of the route is passed, in order, with no jumps", () => {
	const coords = road(600);
	const profile = sim.buildProfile({ coords, speedLimits: coords.slice(0, -1).map(() => ({ speed: 100, unit: "km/h" })) });
	const samples = run(profile, 600, 1 / 60);
	let previous = 0;
	let visited = 0;
	for (const sample of samples) {
		assert.ok(sample.distance >= previous, "never goes backwards");
		assert.ok(sample.distance - previous < 0.6, `moved ${sample.distance - previous} m in one frame`);
		previous = sample.distance;
		visited = Math.max(visited, sample.segment);
	}
	assert.equal(visited, coords.length - 2);
});

test("a right-angle junction is taken slowly and traffic lowers the speed", () => {
	const east = road(300);
	const corner = east[east.length - 1];
	const perMetre = 1 / 110_540;
	const coords = [...east, ...Array.from({ length: 15 }, (_, i) => [corner[0], corner[1] - (i + 1) * 20 * perMetre])];
	const limits = coords.slice(0, -1).map(() => ({ speed: 50, unit: "km/h" }));
	const clear = sim.buildProfile({ coords, speedLimits: limits });
	const cornerIndex = east.length - 1;
	assert.ok(clear.speeds[cornerIndex] < 8, `corner speed ${clear.speeds[cornerIndex]}`);
	assert.ok(clear.speeds[cornerIndex] >= sim.MIN_BEND_MS);
	const heavy = sim.buildProfile({ coords, speedLimits: limits, congestion: coords.slice(0, -1).map(() => "heavy") });
	assert.ok(heavy.speeds[5] < clear.speeds[5]);
});

test("unknown limits carry the last known one forward and roads without limits are driven at 100", () => {
	const coords = road(400);
	const limits = coords.slice(0, -1).map((_, i) => i === 0 ? { speed: 40, unit: "km/h" } : i < 10 ? { unknown: true } : { none: true });
	const profile = sim.buildProfile({ coords, speedLimits: limits });
	assert.ok(profile.speeds[5] <= 40 / 3.6 + 1e-6);
	assert.ok(profile.speeds[15] > 40 / 3.6);
	assert.ok(profile.speeds[15] <= 100 / 3.6 + 1e-6);
});

test("a route replanned mid-drive starts from the speed the car already has", () => {
	const coords = road(400);
	const limits = coords.slice(0, -1).map(() => ({ speed: 50, unit: "km/h" }));
	assert.equal(sim.buildProfile({ coords, speedLimits: limits }, 0).speeds[0], 0);
	assert.ok(Math.abs(sim.buildProfile({ coords, speedLimits: limits }, 12).speeds[0] - 12) < 1e-9);
});

test("locating a position prefers the pass of the route you are on", () => {
	// Out along the road and back again on the same line.
	const out = road(600);
	const coords = [...out, ...out.slice(0, -1).reverse()];
	const cumulative = locate.cumulativeMeters(coords);
	const here = out[10];
	const onWayOut = locate.locateOnRoute(coords, cumulative, here, 8);
	assert.ok(Math.abs(onWayOut.along - cumulative[10]) < 1);
	const onWayBack = locate.locateOnRoute(coords, cumulative, here, coords.length - 12);
	assert.ok(onWayBack.along > cumulative[out.length - 1], "stays on the return leg");
	assert.equal(locate.nearestVertex(coords, cumulative, here, 8), 10);
});

test("a position far from the hint is still found by searching the whole route", () => {
	const coords = road(3000);
	const cumulative = locate.cumulativeMeters(coords);
	const found = locate.locateOnRoute(coords, cumulative, coords[140], 0);
	assert.ok(Math.abs(found.along - cumulative[140]) < 1);
	const point = locate.pointAtDistance(coords, cumulative, cumulative[50] + 10);
	assert.equal(point.segment, 50);
	assert.ok(Math.abs(point.bearing - 90) < 0.5);
});

test("the puck leaves the route line past 30 m and only rejoins within 15 m", () => {
	assert.equal(locate.nextOffTrack(false, 29), false);
	assert.equal(locate.nextOffTrack(false, 31), true);
	assert.equal(locate.nextOffTrack(true, 20), true);
	assert.equal(locate.nextOffTrack(true, 14), false);
});
