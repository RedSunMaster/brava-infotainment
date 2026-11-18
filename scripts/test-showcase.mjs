import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const compiled = ts.transpileModule(await readFile(new URL("../src/lib/showcase.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const S = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));

test("the Earth turns eastward at a steady, unhurried pace", () => {
	assert.equal(S.SPIN_STEP_MS, 15000);
	assert.ok(S.SPIN_DEG_PER_S * 60 >= 180 && S.SPIN_DEG_PER_S * 60 <= 400, "a full turn takes between a minute and two");
	// The camera moves west, so the ground slides east, and wraps cleanly at the dateline.
	assert.deepEqual(S.nextSpinCentre(100), [40, S.GLOBE_LATITUDE]);
	assert.deepEqual(S.nextSpinCentre(-150), [150, S.GLOBE_LATITUDE]);
	assert.equal(S.wrapLongitude(190), -170);
	assert.equal(S.wrapLongitude(-190), 170);
	assert.equal(S.wrapLongitude(0), 0);
});

test("destinations and driving bring the camera down; nothing going on leaves it on the globe", () => {
	const none = { driving: false, navigating: false, destinationPending: false, searchOpen: false, routing: false, choosingBuilding: false };
	assert.equal(S.wantsLocation(none), false);
	for (const key of Object.keys(none)) assert.equal(S.wantsLocation({ ...none, [key]: true }), true, key);
});

test("it goes back to the globe only after being parked and left alone for the whole time", () => {
	const minute = 60000, start = 1_000_000;
	assert.equal(S.idleLongEnough(null, start - 10 * minute, start), false); // not parked
	assert.equal(S.idleLongEnough(start, start, start + 4 * minute), false); // parked four minutes
	assert.equal(S.idleLongEnough(start, start, start + 5 * minute), true);
	// A touch resets the wait; so does the car having just stopped.
	assert.equal(S.idleLongEnough(start, start + 4 * minute, start + 6 * minute), false);
	assert.equal(S.idleLongEnough(start, start + 4 * minute, start + 9 * minute), true);
	assert.equal(S.idleLongEnough(start + 10 * minute, start, start + 12 * minute), false); // stopped two minutes ago
});

test("a flight to the car takes the short way round, however many times the globe has been turned", () => {
	assert.equal(S.nearestLongitude(172, -124), -188);
	assert.equal(S.nearestLongitude(172, 55), 172);
	assert.equal(S.nearestLongitude(172, 140 + 720), 172 + 720);
	assert.equal(S.nearestLongitude(-170, 175), 190);
	for (const from of [-1000, -400, -181, 0, 179, 725]) for (const target of [-180, -42, 0, 172.6, 180]) {
		const at = S.nearestLongitude(target, from);
		assert.ok(Math.abs(at - from) <= 180, `${target} from ${from}`);
		assert.ok(Math.abs(S.wrapLongitude(at) - S.wrapLongitude(target)) < 1e-9);
	}
});
