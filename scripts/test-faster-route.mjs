import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/fasterRoute.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
const { findFasterRoute, remainingSeconds, routeDifference, routeSeconds, describeSaving, routeKey } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
// Straight current route along latitude -43.5, and a parallel road about 2 km north.
const line = (lat, count = 40) => Array.from({ length: count }, (_, i) => [172.5 + i * 0.002, lat]);
const current = line(-43.5), parallel = line(-43.482);
const route = (coords, seconds) => ({ coords, maneuvers: [{ time: seconds }] });

test("time left is the time to the next manoeuvre plus the steps after it", () => {
	const steps = [{ time: 100 }, { time: 200 }, { time: 300 }, { time: 400 }];
	assert.equal(remainingSeconds(steps, 1, 50), 50 + 300 + 400);
	assert.equal(remainingSeconds(steps, 3, NaN), 0);
});
test("a genuinely different road that saves enough time is offered", () => {
	const offer = findFasterRoute(1200, current, [route(parallel, 900)]);
	assert.equal(offer.savedSeconds, 300);
	assert.equal(describeSaving(offer.savedSeconds), "5 min quicker");
});
test("savings that are too small, or on the same road, are not offered", () => {
	assert.equal(findFasterRoute(1200, current, [route(parallel, 1100)]), null); // 100 s saved
	assert.equal(findFasterRoute(1200, current, [route(line(-43.50005), 600)]), null); // same road, only the estimate differs
	assert.equal(findFasterRoute(3600, current, [route(parallel, 3400)]), null); // 200 s is under 8 percent of an hour
});
test("the best of several alternatives wins", () => {
	const offer = findFasterRoute(1500, current, [route(parallel, 1200), route(line(-43.47), 1000)]);
	assert.equal(offer.savedSeconds, 500);
});
test("route comparison and keys are stable", () => {
	assert.equal(routeDifference(current, current), 0);
	assert.equal(routeDifference(parallel, current), 1);
	assert.equal(routeSeconds({ legSeconds: [100, 50], maneuvers: [{ time: 999 }] }), 150);
	assert.equal(routeKey({ coords: parallel }), routeKey({ coords: line(-43.482) }));
	assert.notEqual(routeKey({ coords: parallel }), routeKey({ coords: current }));
});
