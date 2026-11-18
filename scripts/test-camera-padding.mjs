import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const compiled = ts.transpileModule(await readFile(new URL("../src/lib/cameraPadding.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { verticalShare, maxPitchFor, CLOSE_ZOOM, paddingFor, samePadding, puckOffset, puckScreenPoint } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
const insets = { top: 170, bottom: 300, left: 124, right: 0 };
const mapWith = (pad, width = 1080, height = 1920) => ({ getContainer: () => ({ clientWidth: width, clientHeight: height }), getPadding: () => pad });

test("zoomed out the whole view is centred in the free space; driving keeps only the sideways inset", () => {
	assert.equal(verticalShare(1.5), 1);
	assert.equal(verticalShare(16.5), 0);
	assert.ok(verticalShare(7) > 0 && verticalShare(7) < 1);
	assert.deepEqual(paddingFor(insets, 1.5), { top: 170, bottom: 300, left: 124, right: 0 });
	assert.deepEqual(paddingFor(insets, 16.5), { top: 0, bottom: 0, left: 124, right: 0 });
	assert.ok(samePadding({ top: 0.4 }, {}));
	assert.ok(!samePadding({ left: 5 }, { left: 0 }));
});

test("the tilt comes out as the camera climbs, so the Earth is square on", () => {
	assert.equal(maxPitchFor(1.5), 0);
	assert.equal(maxPitchFor(4), 0);
	assert.equal(maxPitchFor(16.5), 45);
	assert.ok(maxPitchFor(6) > 0 && maxPitchFor(6) < 45);
	assert.ok(maxPitchFor(5) < maxPitchFor(6) && maxPitchFor(6) < maxPitchFor(7));
	assert.ok(CLOSE_ZOOM > 5);
});

test("the car stays where the camera says whatever the padding is", () => {
	// No padding: the old behaviour, a fifth of the screen below the middle.
	assert.deepEqual(puckOffset(mapWith({}), 0.2), [0, 384]);
	// A left dock alone changes nothing vertically, and the car's screen point moves into the middle of the free space.
	assert.deepEqual(puckOffset(mapWith({ left: 124 }), 0.2), [0, 384]);
	assert.deepEqual(puckScreenPoint(mapWith({ left: 124 }), 0.2), [124 + (1080 - 124) / 2, 1920 * 0.7]);
	// With top and bottom padding the middle of the padded area is higher or lower, so the offset makes up the difference
	// and the car ends up at the same 70% of the screen height.
	const pad = { top: 170, bottom: 300 };
	const [, y] = puckOffset(mapWith(pad), 0.2);
	const middle = 170 + (1920 - 170 - 300) / 2;
	assert.equal(middle + y, 1920 * 0.7);
	// And a right dock puts the car left of the middle.
	assert.equal(puckScreenPoint(mapWith({ right: 124 }), 0)[0], (1080 - 124) / 2);
});
