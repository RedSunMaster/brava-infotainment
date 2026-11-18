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
	assert.deepEqual(L.normaliseLayout([{ id: "fan", span: 9 }, { id: "fan", span: 3 }, { id: "bogus", span: 1 }, { id: "ac", span: 7 }]), [{ id: "fan", span: 6 }, { id: "ac", span: 4 }, { id: "hazards", span: 1 }]); // sizes snap to the nearest the tile has
	// Too big once hazards are added: the widest tile shrinks rather than anything being dropped.
	const full = L.normaliseLayout([{ id: "fan", span: 5 }, { id: "warmth", span: 4 }, { id: "volume", span: 4 }]);
	assert.deepEqual(ids(full), ["fan", "warmth", "volume", "hazards"]);
	assert.deepEqual(full.map(i => i.span), [4, 4, 4, 1]);
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
	assert.equal(L.canStep(L.DEFAULT_LAYOUT, "ac", 1), false); // the dock is full
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

test("a side dock: cells from the screen height, and a big layout shrinks to fit before anything is lost", () => {
	assert.equal(L.sideColumns(1870), 13); // portrait car screen
	assert.equal(L.sideColumns(672), 8); // short landscape screen
	assert.equal(L.sideColumns(100), 6); // never absurdly small
	assert.ok(L.isDockSide("left") && L.isDockSide("right") && L.isDockSide("bottom") && !L.isDockSide("top"));
	const eight = L.normaliseLayout(L.DEFAULT_LAYOUT, 8);
	assert.ok(L.usedCells(eight) <= 8);
	assert.equal(eight.at(-1).id, "hazards");
	assert.deepEqual(ids(eight).slice(0, 4), ["fan", "airflow", "recirculate", "demist"]);
	assert.equal(eight[0].span, 3); // fan shrank first
	const tiny = L.normaliseLayout(L.DEFAULT_LAYOUT, 6);
	assert.ok(L.usedCells(tiny) <= 6);
	assert.ok(ids(tiny).includes("hazards"));
	// The same stored layout still fills a full-height dock.
	assert.deepEqual(L.normaliseLayout(L.DEFAULT_LAYOUT, 13), L.DEFAULT_LAYOUT);
});

test("editing and dragging respect the dock's own number of cells", () => {
	const eight = L.normaliseLayout(L.DEFAULT_LAYOUT, 8);
	assert.equal(L.freeCells(eight, 8), 0);
	assert.equal(L.addWidget(eight, "playPause", 8), eight);
	assert.equal(L.canStep(eight, "fan", 1, 8), false);
	assert.equal(L.canStep(eight, "fan", 1, 13), true);
	// Snap to the far end uses the dock's own length.
	const moved = L.dragWidget(eight, "airflow", 6.4, 1, 8);
	assert.equal(moved.at(-1).id, "airflow");
});

test("every function can be made bigger, hazard lights included", () => {
	for (const id of L.WIDGET_IDS) assert.ok(L.WIDGETS[id].sizes.length > 1, `${id} has more than one size`);
	// The default dock is full: shrink the fan and warmth to free cells, then grow the hazard lights step by step.
	let layout = L.stepWidgetSize(L.DEFAULT_LAYOUT, "fan", -1);
	layout = L.stepWidgetSize(layout, "warmth", -1);
	assert.equal(L.freeCells(layout), 2);
	layout = L.stepWidgetSize(layout, "hazards", 1);
	assert.equal(layout.find(i => i.id === "hazards").span, 2);
	layout = L.stepWidgetSize(layout, "hazards", 1);
	assert.equal(layout.find(i => i.id === "hazards").span, 3);
	assert.equal(L.canStep(layout, "hazards", 1), false); // no free cell left
	assert.equal(L.canStep(layout, "hazards", -1), true);
	assert.equal(L.usedCells(layout), 13);
	// They cannot go past their largest size even with room.
	let roomy = [{ id: "ac", span: 3 }, { id: "hazards", span: 1 }];
	roomy = L.stepWidgetSize(roomy, "ac", 1);
	assert.equal(L.canStep(roomy, "ac", 1), false);
	// Bigger tiles still shrink to fit a short side dock, hazard lights last.
	const big = [{ id: "hazards", span: 4 }, { id: "ac", span: 4 }, { id: "fan", span: 6 }];
	const fitted = L.normaliseLayout(big, 8);
	assert.ok(L.usedCells(fitted) <= 8);
	assert.ok(fitted.some(i => i.id === "hazards"));
});
