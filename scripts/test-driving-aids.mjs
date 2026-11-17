import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const load = async name => {
	const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
	const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
	return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
};
const { limitAt, speedSignState } = await load("speedSigns");
const { laneHighlight, usefulLanes, laneArrows } = await load("laneGuidance");
const { advanceAlongRoute, estimatedDistance } = await load("deadReckoning");
const { createDucking, duckedVolume } = await load("audioDucking");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("speed limit is only trusted on the route and ignores unknown segments", () => {
	const limits = [{ speed: 50, unit: "km/h" }, { unknown: true }, { none: true }, { speed: 30, unit: "mph" }];
	assert.deepEqual(limitAt(limits, 0, true), { kind: "limit", speed: 50, unit: "km/h" });
	assert.equal(limitAt(limits, 0, false), null);
	assert.equal(limitAt(limits, 1, true), null);
	assert.deepEqual(limitAt(limits, 2, true), { kind: "none" });
	assert.deepEqual(limitAt(limits, 99, true), { kind: "limit", speed: 30, unit: "mph" });
	assert.equal(limitAt(undefined, 0, true), null);
});

test("speed sign turns red only when clearly over the limit, in the limit's unit", () => {
	const limit = { kind: "limit", speed: 50, unit: "km/h" };
	assert.deepEqual([speedSignState(13.9, limit).speed, speedSignState(13.9, limit).over], [50, false]);
	assert.equal(speedSignState(52 / 3.6, limit).over, false);
	assert.equal(speedSignState(54 / 3.6, limit).over, true);
	const mph = speedSignState(13.4, { kind: "limit", speed: 25, unit: "mph" });
	assert.deepEqual([mph.speed, mph.unit, mph.over], [30, "mph", true]);
	assert.equal(speedSignState(-3, null).speed, 0);
});

test("lane guidance highlights the arrow that leads along the route", () => {
	const lane = { indications: ["straight", "right"], valid: true, valid_indication: "right" };
	assert.equal(laneHighlight(lane, "straight"), "right");
	assert.equal(laneHighlight({ indications: ["straight", "right"], valid: true }, "right"), "right");
	assert.equal(laneHighlight({ indications: ["left"], valid: false }, "left"), null);
	assert.deepEqual(laneArrows({ indications: ["none"], valid: false }), []);
});

test("lanes are shown only when they help and the turn is near", () => {
	const lanes = [{ indications: ["left"], valid: false }, { indications: ["right"], valid: true }];
	assert.equal(usefulLanes(lanes, 400), lanes);
	assert.equal(usefulLanes(lanes, 3000), null);
	assert.equal(usefulLanes(lanes, null), lanes);
	assert.equal(usefulLanes([lanes[1]], 100), null);
	assert.equal(usefulLanes([{ indications: ["left"], valid: true }, { indications: ["right"], valid: true }], 100), null);
	assert.equal(usefulLanes([{ indications: ["left"], valid: false }, { indications: ["right"], valid: false }], 100), null);
});

test("dead reckoning walks the route at the last speed and bends with it", () => {
	const route = [[172, -43], [172.01, -43], [172.01, -43.01]];
	const first = advanceAlongRoute(route, [172, -43], 400);
	assert.ok(first && !first.atEnd);
	assert.ok(first.pos[0] > 172.004 && first.pos[0] < 172.006 && first.pos[1] === -43);
	assert.ok(Math.abs(first.bearing - 90) < 1);
	const around = advanceAlongRoute(route, [172, -43], 1000);
	assert.ok(around.pos[0] === 172.01 && around.pos[1] < -43);
	assert.ok(Math.abs(around.bearing - 180) < 1);
	const end = advanceAlongRoute(route, [172, -43], 99999);
	assert.deepEqual([end.atEnd, end.pos], [true, route[2]]);
});

test("a position off the road is projected onto it before moving", () => {
	const route = [[172, -43], [172.02, -43]];
	const estimate = advanceAlongRoute(route, [172.01, -43.0005], 100);
	assert.ok(estimate.pos[0] > 172.01 && estimate.pos[1] === -43);
});

test("estimating starts after the signal is lost and stops when it is not credible", () => {
	const fix = { pos: [172, -43], time: 0, speed: 20 };
	assert.equal(estimatedDistance(1000, fix), null);
	assert.equal(estimatedDistance(10_000, fix), 200);
	assert.equal(estimatedDistance(200_000, fix), null);
	assert.equal(estimatedDistance(10_000, { ...fix, speed: 0.5 }), null);
	assert.equal(estimatedDistance(10_000, null), null);
});

test("music stays down between back-to-back phrases and comes back after", async () => {
	const ducking = createDucking(40, 1000);
	const events = [];
	ducking.subscribe(ducked => events.push(ducked));
	const first = ducking.begin();
	first();
	first();
	await wait(10);
	const second = ducking.begin();
	assert.deepEqual(events, [true]);
	second();
	await wait(80);
	assert.deepEqual(events, [true, false]);
	assert.equal(ducking.ducked, false);
});

test("music is restored even if the end of speech is never reported", async () => {
	const ducking = createDucking(10, 30);
	const events = [];
	ducking.subscribe(ducked => events.push(ducked));
	ducking.begin();
	await wait(100);
	assert.deepEqual(events, [true, false]);
	assert.equal(duckedVolume(80), 24);
	assert.equal(duckedVolume(0), 0);
});
