import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/announceTiming.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
const { thresholds, bandFor, shouldAnnounce, quietForNotice } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("warning distances grow with speed but never drop below a sensible minimum", () => {
	assert.deepEqual(thresholds(0), { reminder: 400, now: 80 });
	assert.deepEqual(thresholds(8), { reminder: 400, now: 80 });
	const motorway = thresholds(28);
	assert.equal(motorway.reminder, 700);
	assert.equal(motorway.now, 140);
});

// Drives a turn from `start` metres away at a constant speed and lists what is said, and at what distance.
function drive(start, speedMs, step = 10) {
	const spoken = [];
	let last = null;
	for (let distance = start; distance >= 0; distance -= step) {
		const first = last === null;
		const band = bandFor(distance, speedMs, first);
		if (shouldAnnounce(band, last)) { spoken.push([band, distance]); last = band; }
	}
	return spoken;
}

test("a long leg is announced far out, reminded part-way and announced again at the turn", () => {
	const spoken = drive(2000, 14);
	assert.deepEqual(spoken.map(([band]) => band), ["far", "reminder", "now"]);
	assert.equal(spoken[0][1], 2000);
	assert.ok(spoken[1][1] <= 400 && spoken[1][1] > 380);
	assert.ok(spoken[2][1] <= 80 && spoken[2][1] > 70);
});

test("faster driving gets the reminder and the final instruction earlier", () => {
	const slow = drive(2000, 8);
	const fast = drive(2000, 28);
	assert.ok(fast[1][1] > slow[1][1] + 200, `${fast[1][1]} vs ${slow[1][1]}`);
	assert.ok(fast[2][1] > slow[2][1] + 40);
});

test("a turn that starts close is announced once as a reminder, then at the turn, never twice in a row", () => {
	assert.deepEqual(drive(450, 14).map(([band]) => band), ["reminder", "now"]);
	assert.deepEqual(drive(150, 14).map(([band]) => band), ["reminder", "now"]);
	assert.deepEqual(drive(60, 14).map(([band]) => band), ["now"]);
});

test("a stage is never repeated or spoken backwards when the distance wobbles", () => {
	assert.equal(shouldAnnounce("reminder", "now"), false);
	assert.equal(shouldAnnounce("now", "now"), false);
	assert.equal(shouldAnnounce("now", "reminder"), true);
	assert.equal(shouldAnnounce("far", null), true);
});

test("notices wait while a turn is close or was just spoken", () => {
	assert.equal(quietForNotice(1000, 20000), true);
	assert.equal(quietForNotice(null, 20000), true);
	assert.equal(quietForNotice(200, 20000), false);
	assert.equal(quietForNotice(1000, 3000), false);
});
