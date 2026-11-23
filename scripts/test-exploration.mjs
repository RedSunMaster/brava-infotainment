import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
/** A source file compiled to a data: URL, with its imports of other files in `links` pointed at their URLs. */
async function compile(name, links = {}) {
	const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
	let compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
	for (const [from, url] of Object.entries(links)) compiled = compiled.replaceAll(`"./${from}"`, JSON.stringify(url));
	return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}
const explorationUrl = await compile("exploration");
const { Explorer, toCellSpace, cellKey, REVEAL_RADIUS_M, metersPerCell } = await import(explorationUrl);
const { outlineFromNominatim, contains, cellsInside, shareExplored, FULLY_EXPLORED } = await import(await compile("suburbs", { exploration: explorationUrl }));
const { newMilestones } = await import(await compile("milestones"));

const ORIGIN = [172.60685, -43.45389];
const M_LAT = 1 / 111_195;
const M_LNG = 1 / (111_195 * Math.cos((ORIGIN[1] * Math.PI) / 180));
/** A point east/north of the origin, in metres. */
const at = (east, north) => [ORIGIN[0] + east * M_LNG, ORIGIN[1] + north * M_LAT];
const seen = (explorer, pos) => { const [x, y] = toCellSpace(pos); return explorer.cells.has(cellKey(Math.floor(x), Math.floor(y))); };

/** Drives a path of [east, north] corners, one fix every `step` metres. */
function drive(explorer, corners, step = 20, start = 0) {
	let time = start;
	const results = [];
	for (let i = 1; i < corners.length; i++) {
		const [ax, ay] = corners[i - 1], [bx, by] = corners[i];
		const length = Math.hypot(bx - ax, by - ay);
		for (let d = i === 1 ? 0 : step; d <= length; d += step) {
			time += 1000;
			results.push(explorer.addFix(at(ax + ((bx - ax) * d) / length, ay + ((by - ay) * d) / length), time));
		}
	}
	return results;
}

test("a straight drive uncovers line of sight either side, and nothing further", () => {
	const explorer = new Explorer();
	drive(explorer, [[0, 0], [1000, 0]]);
	assert.ok(seen(explorer, at(500, 0)));
	assert.ok(seen(explorer, at(500, REVEAL_RADIUS_M - 30)));
	assert.ok(seen(explorer, at(500, -(REVEAL_RADIUS_M - 30))));
	assert.ok(!seen(explorer, at(500, REVEAL_RADIUS_M + 60)));
	assert.ok(!seen(explorer, at(1300, 0)));
	assert.ok(Math.abs(explorer.distanceM - 1000) < 5);
	// About 1 km × 100 m, give or take the rounded ends and cell edges.
	assert.ok(explorer.areaM2 > 70_000 && explorer.areaM2 < 170_000, String(explorer.areaM2));
});

test("driving round a park uncovers its middle", () => {
	const explorer = new Explorer();
	// A 700 m square: its centre is 350 m from every side, well beyond line of sight.
	const results = drive(explorer, [[0, 0], [700, 0], [700, 700], [0, 700], [0, 0], [100, 0]]);
	const loop = results.find(item => item.loop)?.loop;
	assert.ok(loop, "the loop closed");
	assert.ok(loop.areaM2 > 400_000 && loop.areaM2 < 520_000, String(loop.areaM2));
	assert.ok(seen(explorer, at(350, 350)));
});

test("the middle stays fogged until the loop is closed", () => {
	const explorer = new Explorer();
	drive(explorer, [[0, 0], [700, 0], [700, 700], [0, 700], [0, 200]]);
	assert.ok(!seen(explorer, at(350, 350)));
});

test("a loop bigger than a square kilometre does not fill", () => {
	const explorer = new Explorer();
	const results = drive(explorer, [[0, 0], [1500, 0], [1500, 1500], [0, 1500], [0, 0], [100, 0]]);
	assert.ok(!results.some(item => item.loop));
	assert.ok(!seen(explorer, at(750, 750)));
});

test("driving back the way you came is not a loop", () => {
	const explorer = new Explorer();
	const results = drive(explorer, [[0, 0], [800, 0], [0, 0]]);
	assert.ok(!results.some(item => item.loop));
});

test("a crossing closes a loop too (a figure of eight)", () => {
	const explorer = new Explorer();
	const results = drive(explorer, [[0, 0], [1000, 1000], [1000, 0], [0, 1000]]);
	assert.ok(results.some(item => item.loop), "crossing the earlier line closes the loop");
	assert.ok(seen(explorer, at(790, 500)));
});

test("a GPS gap does not join the two ends", () => {
	const explorer = new Explorer();
	explorer.addFix(at(0, 0), 0);
	explorer.addFix(at(1500, 0), 300_000);
	assert.ok(!seen(explorer, at(750, 0)));
	assert.equal(explorer.distanceM, 0);
});

test("standing still adds nothing", () => {
	const explorer = new Explorer();
	explorer.addFix(at(0, 0), 0);
	const before = explorer.cells.size;
	for (let i = 1; i < 30; i++) assert.equal(explorer.addFix(at(Math.sin(i) * 3, Math.cos(i) * 3), i * 1000).added.length, 0);
	assert.equal(explorer.cells.size, before);
	assert.equal(explorer.distanceM, 0);
});

test("new road distance counts only roads not seen before", () => {
	const explorer = new Explorer();
	drive(explorer, [[0, 0], [1000, 0]]);
	explorer.endDrive();
	drive(explorer, [[0, 0], [1000, 0]], 20, 1_000_000);
	assert.ok(Math.abs(explorer.distanceM - 2000) < 10);
	assert.ok(Math.abs(explorer.newDistanceM - 1000) < 60, String(explorer.newDistanceM));
});

test("saving and loading keeps every cell, the stats and the places", () => {
	const explorer = new Explorer();
	drive(explorer, [[0, 0], [700, 0], [700, 700], [0, 700], [0, 0], [100, 0]]);
	explorer.discover({ id: "locality.1", name: "Riccarton", kind: "locality", coords: at(0, 0), at: 5 });
	assert.equal(explorer.discover({ id: "locality.1", name: "Riccarton", kind: "locality", coords: at(0, 0), at: 6 }), false);
	const copy = Explorer.fromJSON(JSON.parse(JSON.stringify(explorer.toJSON())));
	assert.equal(copy.cells.size, explorer.cells.size);
	for (const key of explorer.cells) assert.ok(copy.cells.has(key));
	assert.ok(Math.abs(copy.areaM2 - explorer.areaM2) < 1);
	assert.equal(copy.distanceM, explorer.distanceM);
	assert.equal(copy.places.length, 1);
});

test("maps saved with the old, coarser cells load with each cell split into four", () => {
	const old = 2 ** 19;
	const key = 300_000 * old + 400_000;
	const explorer = Explorer.fromJSON({ v: 1, cells: [key], distanceM: 5, newDistanceM: 2, places: [], startedAt: 1 });
	assert.equal(explorer.cells.size, 4);
	for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) assert.ok(explorer.cells.has((600_000 + dx) * 2 ** 20 + 800_000 + dy));
	assert.equal(explorer.distanceM, 5);
});

test("one fix uncovers a round patch, not a blocky one", () => {
	const explorer = new Explorer();
	explorer.addFix(at(0, 0), 0);
	// About π × 50² of ground, in 28 m cells: around ten of them.
	assert.ok(explorer.cells.size > 6, String(explorer.cells.size));
	// Line of sight reaches round evenly: seen 30 m away in every direction (diagonals too), and not at 100 m.
	for (let angle = 0; angle < 360; angle += 45) {
		const r = (angle * Math.PI) / 180;
		assert.ok(seen(explorer, at(30 * Math.cos(r), 30 * Math.sin(r))), `30 m at ${angle}°`);
		assert.ok(!seen(explorer, at(100 * Math.cos(r), 100 * Math.sin(r))), `100 m at ${angle}°`);
	}
});

test("damaged saves load as a fresh map", () => {
	assert.equal(Explorer.fromJSON(null).cells.size, 0);
	assert.equal(Explorer.fromJSON({ v: 99, cells: [1, 2] }).cells.size, 0);
	assert.equal(Explorer.fromJSON({ v: 1, cells: ["x"] }).cells.size, 0);
});

test("share around home grows as you explore", () => {
	const explorer = new Explorer();
	assert.equal(explorer.shareAround(at(0, 0), 1000), 0);
	drive(explorer, [[-1000, 0], [1000, 0]]);
	const share = explorer.shareAround(at(0, 0), 1000);
	assert.ok(share > 0.03 && share < 0.12, String(share));
	assert.ok(metersPerCell(ORIGIN[1]) > 25 && metersPerCell(ORIGIN[1]) < 32);
});

test("only maps this version understands count as readable (anything else is never saved over)", () => {
	assert.equal(Explorer.canRead({ v: 2, cells: [] }), true);
	assert.equal(Explorer.canRead({ v: 1, cells: [] }), true);
	assert.equal(Explorer.canRead({ v: 99 }), false);
	assert.equal(Explorer.canRead(null), false);
	assert.equal(Explorer.canRead("garbage"), false);
});

test("ground explored while the saved map could not be read is added to it once it loads", () => {
	const saved = new Explorer();
	drive(saved, [[0, 0], [500, 0]]);
	saved.discover({ id: "locality.1", name: "Riccarton", kind: "locality", coords: at(0, 0), at: 5 });
	const meanwhile = new Explorer();
	drive(meanwhile, [[0, 400], [500, 400]]);
	meanwhile.discover({ id: "locality.2", name: "Fendalton", kind: "locality", coords: at(0, 400), at: 6 });
	const before = saved.cells.size;
	saved.merge(meanwhile);
	assert.ok(saved.cells.size > before);
	assert.ok(seen(saved, at(250, 0)) && seen(saved, at(250, 400)));
	assert.ok(Math.abs(saved.distanceM - 1000) < 10);
	assert.deepEqual(saved.places.map(p => p.name), ["Riccarton", "Fendalton"]);
});

/** A square suburb `side` metres across with its south-west corner at the origin, as Nominatim returns it. */
function squareSuburb(side, extra = {}) {
	const ring = [at(0, 0), at(side, 0), at(side, side), at(0, side), at(0, 0)];
	return { osm_type: "relation", osm_id: 1, name: "Testville", addresstype: "suburb", geojson: { type: "Polygon", coordinates: [ring] }, ...extra };
}

test("a suburb outline is read from a lookup, and cities or point-only results are not", () => {
	const outline = outlineFromNominatim(squareSuburb(1000));
	assert.equal(outline.id, "relation:1");
	assert.ok(contains(outline, at(500, 500)) && !contains(outline, at(1500, 500)));
	assert.equal(outlineFromNominatim(squareSuburb(1000, { addresstype: "city" })), null);
	assert.equal(outlineFromNominatim({ ...squareSuburb(1000), geojson: { type: "Point", coordinates: at(0, 0) } }), null);
	// Far bigger than any suburb.
	assert.equal(outlineFromNominatim(squareSuburb(8000)), null);
});

test("a suburb's cells cover its area, and holes are left out", () => {
	const outline = outlineFromNominatim(squareSuburb(1000));
	const cells = cellsInside(outline);
	const expected = 1e6 / metersPerCell(ORIGIN[1]) ** 2;
	assert.ok(Math.abs(cells.length - expected) / expected < 0.03, `${cells.length} vs ${expected}`);
	const hole = [at(250, 250), at(750, 250), at(750, 750), at(250, 750), at(250, 250)];
	const holed = outlineFromNominatim({ ...squareSuburb(1000), geojson: { type: "Polygon", coordinates: [squareSuburb(1000).geojson.coordinates[0], hole] } });
	const ratio = cellsInside(holed).length / cells.length;
	assert.ok(Math.abs(ratio - 0.75) < 0.03, String(ratio));
});

test("driving through a suburb raises its progress, and 90% of it counts as all", () => {
	const outline = outlineFromNominatim(squareSuburb(1000));
	const cells = cellsInside(outline);
	const explorer = new Explorer();
	assert.equal(shareExplored(cells, explorer.cells), 0);
	drive(explorer, [[0, 500], [1000, 500]]);
	const one = shareExplored(cells, explorer.cells);
	// One road across: about 100 m of the 1000 m, scaled up by FULLY_EXPLORED.
	assert.ok(one > 0.09 && one < 0.16, String(one));
	const seen = new Set(cells.slice(0, Math.ceil(cells.length * FULLY_EXPLORED)));
	assert.equal(shareExplored(cells, seen), 1);
});

test("milestones are reached once, and only the biggest new one of a kind is announced", () => {
	const state = { areaKm2: 6, newRoadsKm: 12, places: 5, suburbs: [{ id: "a", name: "Northwood", share: 0.6 }] };
	const first = newMilestones(state, new Set());
	assert.deepEqual(first.all.map(m => m.id), ["area:1", "area:2", "area:5", "roads:10", "places:5", "suburb:a:25", "suburb:a:50"]);
	assert.deepEqual(first.announce.map(m => m.title), ["5 km² explored", "10 km of new roads", "5 places discovered", "Half of Northwood explored"]);
	const achieved = new Set(first.all.map(m => m.id));
	assert.equal(newMilestones(state, achieved).all.length, 0);
	const done = newMilestones({ ...state, suburbs: [{ id: "a", name: "Northwood", share: 1 }] }, achieved);
	assert.deepEqual(done.announce.map(m => m.title), ["First suburb fully explored", "Northwood fully explored"]);
});

test("milestones and suburbs are saved, and a map from before them is marked for quiet catch-up", () => {
	const explorer = new Explorer();
	explorer.reach([{ id: "area:1", title: "1 km² explored", kind: "area", at: 5 }]);
	explorer.visitSuburb({ id: "relation:1", name: "Testville", at: 6 });
	assert.equal(explorer.visitSuburb({ id: "relation:1", name: "Testville", at: 7 }), false);
	const loaded = Explorer.fromJSON(JSON.parse(JSON.stringify(explorer.toJSON())));
	assert.deepEqual(loaded.milestones.map(m => m.id), ["area:1"]);
	assert.deepEqual(loaded.suburbs.map(s => s.name), ["Testville"]);
	assert.equal(loaded.milestonesKnown, true);
	const old = explorer.toJSON();
	delete old.milestones;
	assert.equal(Explorer.fromJSON(old).milestonesKnown, false);
	assert.deepEqual(explorer.reach([{ id: "area:1", title: "", kind: "area", at: 9 }, { id: "area:2", title: "", kind: "area", at: 9 }]).map(m => m.id), ["area:2"]);
});
