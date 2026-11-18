import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/dockLayout.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
const L = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const ids = layout => layout.map(item => item.id);

test("the default dock fills the whole bar, edge to edge", () => {
	assert.equal(L.DOCK_COLUMNS, 13);
	assert.equal(L.usedCells(L.DEFAULT_LAYOUT), 13);
	assert.equal(L.freeCells(L.DEFAULT_LAYOUT), 0);
	assert.deepEqual(L.startColumns(L.DEFAULT_LAYOUT), [1, 5, 6, 7, 8, 9, 13]);
});

test("a dock still stored as the first version's default becomes the new default; real edits are kept", () => {
	const legacy = [{ id: "fan", span: 3 }, { id: "airflow", span: 1 }, { id: "recirculate", span: 1 }, { id: "demist", span: 1 }, { id: "ac", span: 1 }, { id: "warmth", span: 3 }, { id: "hazards", span: 1 }];
	assert.deepEqual(L.normaliseLayout(legacy), L.DEFAULT_LAYOUT);
	const edited = [...legacy.slice(0, 4), { id: "warmth", span: 3 }, { id: "hazards", span: 1 }];
	assert.deepEqual(ids(L.normaliseLayout(edited)), ["fan", "airflow", "recirculate", "demist", "warmth", "hazards"]);
});

test("stored layouts are cleaned: unknown, repeated, oversize and missing hazards", () => {
	assert.deepEqual(L.normaliseLayout(null), L.DEFAULT_LAYOUT);
	assert.deepEqual(L.normaliseLayout([{ id: "fan", span: 9 }, { id: "fan", span: 3 }, { id: "bogus", span: 1 }, { id: "ac", span: 7 }]), [{ id: "fan", span: 5 }, { id: "ac", span: 1 }, { id: "hazards", span: 1 }]);
	const full = L.normaliseLayout([{ id: "fan", span: 5 }, { id: "warmth", span: 4 }, { id: "volume", span: 4 }]);
	assert.equal(full.at(-1).id, "hazards"); // made room by dropping the last tile
	assert.deepEqual(ids(full), ["fan", "warmth", "hazards"]);
	assert.ok(L.usedCells(full) <= L.DOCK_COLUMNS);
});

test("adding, removing and the pinned hazard lights", () => {
	assert.equal(L.addWidget(L.DEFAULT_LAYOUT, "playPause"), L.DEFAULT_LAYOUT); // a full dock has no room
	let layout = L.removeWidget(L.DEFAULT_LAYOUT, "fan");
	assert.equal(L.freeCells(layout), 4);
	layout = L.addWidget(layout, "volume");
	assert.deepEqual(layout.at(-1), { id: "volume", span: 3 });
	assert.equal(L.freeCells(layout), 1);
	layout = L.addWidget(layout, "playPause");
	assert.equal(L.addWidget(layout, "nextTrack"), layout);
	assert.equal(L.removeWidget(layout, "hazards"), layout);
	assert.ok(!L.availableWidgets(layout).includes("hazards"));
	assert.ok(L.availableWidgets(layout).includes("fan"));
});

test("resizing only to supported sizes and only when there is room", () => {
	assert.equal(L.canStep(L.DEFAULT_LAYOUT, "fan", 1), false); // dock is full
	assert.equal(L.canStep(L.DEFAULT_LAYOUT, "fan", -1), true);
	const smaller = L.stepWidgetSize(L.DEFAULT_LAYOUT, "fan", -1);
	assert.equal(smaller[0].span, 3);
	assert.equal(L.canStep(smaller, "warmth", 1), true); // the freed cell
	assert.equal(L.stepWidgetSize(smaller, "warmth", 1).find(i => i.id === "warmth").span, 5);
	assert.equal(L.canStep(L.stepWidgetSize(smaller, "warmth", 1), "fan", 1), false);
	assert.equal(L.canStep(smaller, "fan", -1), false); // smallest size
	assert.equal(L.canStep(L.DEFAULT_LAYOUT, "ac", 1), false); // 1x1 only
});

test("dragging: swaps when half covered, never jumps at the start, easy snap to either end", () => {
	const D = L.DEFAULT_LAYOUT;
	// Picking a tile up and not moving it changes nothing, in either direction.
	for (const dir of [1, -1]) for (const [id, left] of [["fan", 0], ["warmth", 8], ["ac", 7], ["hazards", 12]]) assert.equal(L.dragWidget(D, id, left, dir), D, id);
	// Warmth (8-12) dragged left: it has to cover half of the ac switch (centre 7.5) before they trade places.
	assert.equal(L.dragWidget(D, "warmth", 7.8, -1), D);
	assert.deepEqual(ids(L.dragWidget(D, "warmth", 7.4, -1)).slice(3, 6), ["demist", "warmth", "ac"]);
	// Across several tiles in one move, as a fast finger does.
	assert.deepEqual(ids(L.dragWidget(D, "warmth", 4.2, -1)).slice(0, 3), ["fan", "warmth", "airflow"]);
	// Within reach of the dock's left edge it snaps to first, even past the wide fan.
	assert.deepEqual(ids(L.dragWidget(D, "warmth", 0.6, -1)).slice(0, 2), ["warmth", "fan"]);
	assert.equal(L.dragWidget(D, "warmth", 2.5, -1)[0].id, "fan");
	// Fan dragged right: its right edge leads; near the far end it snaps to last.
	assert.deepEqual(ids(L.dragWidget(D, "fan", 0.4, 1)).slice(0, 2), ["fan", "airflow"]);
	assert.deepEqual(ids(L.dragWidget(D, "fan", 0.6, 1)).slice(0, 2), ["airflow", "fan"]);
	assert.deepEqual(ids(L.dragWidget(D, "fan", 2.2, 1)).slice(0, 4), ["airflow", "recirculate", "fan", "demist"]);
	assert.equal(L.dragWidget(D, "fan", 8.6, 1).at(-1).id, "fan");
});

test("moving", () => {
	const moved = L.moveWidget(L.DEFAULT_LAYOUT, "ac", 0);
	assert.deepEqual(ids(moved).slice(0, 3), ["ac", "fan", "airflow"]);
	assert.equal(L.moveWidget(L.DEFAULT_LAYOUT, "fan", 0), L.DEFAULT_LAYOUT);
});
