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
const { distanceM } = await import(explorationUrl);
const { Pacman, dotsAlong, dotsFromWays, dotId, multiplierFor, tileOf, tileKey, tileBounds, tilesAround, DOT_SPACING_M, EAT_RADIUS_M, POINTS_DOT, STREAK_GAP_MS, REGROW_MS } = await import(await compile("pacman", { exploration: explorationUrl }));
const { toLocalMetres, MERCATOR_M_PER_DEGREE } = await import(await compile("localMetres", { exploration: explorationUrl }));
const { initialGameMode, isGameMode, GAME_MODES } = await import(await compile("gameModes"));

const ORIGIN = [172.60685, -43.45389];
const M_LAT = 1 / 111_195;
const M_LNG = 1 / (111_195 * Math.cos((ORIGIN[1] * Math.PI) / 180));
/** A point east/north of the origin, in metres. */
const at = (east, north) => [ORIGIN[0] + east * M_LNG, ORIGIN[1] + north * M_LAT];
/** A straight road east from the origin, as the flat lng, lat list the main process sends. */
const road = (length, north = 0) => [...at(0, north), ...at(length, north)];
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24, 12);

/** Drives east along a road in fixes `step` metres apart, as a real drive does. Returns the dots eaten. */
function drive(game, fromEast, toEast, now, north = 0, step = 14) {
	let eaten = 0, last = at(fromEast, north);
	for (let east = fromEast + step; east < toEast + step; east += step) { const here = at(Math.min(east, toEast), north); eaten += game.eatAlong(last, here, now).eaten.length; last = here; }
	return eaten;
}

/** A game with one tile of the given roads loaded. */
function gameWith(ways, regrow = "week") {
	const game = new Pacman();
	game.regrow = regrow;
	game.addTile("t", dotsFromWays(ways));
	return game;
}

test("dots go along a road every spacing, starting half a spacing in", () => {
	const dots = dotsAlong([at(0, 0), at(300, 0)]);
	assert.equal(dots.length, 10);
	assert.ok(Math.abs(distanceM(at(0, 0), dots[0].pos) - DOT_SPACING_M / 2) < 0.5);
	for (let i = 1; i < dots.length; i++) assert.ok(Math.abs(distanceM(dots[i - 1].pos, dots[i].pos) - DOT_SPACING_M) < 0.5);
	// Half a spacing is left at the far end too.
	assert.ok(Math.abs(distanceM(dots.at(-1).pos, at(300, 0)) - DOT_SPACING_M / 2) < 0.5);
});

test("dots follow the bends of a road", () => {
	const dots = dotsAlong([at(0, 0), at(100, 0), at(100, 100)]);
	assert.equal(dots.length, 6);
	assert.ok(dots.some(dot => distanceM(dot.pos, at(100, 0)) < 20));
	assert.ok(dots.every(dot => dot.pos[0] <= at(101, 0)[0] && dot.pos[1] >= at(0, -1)[1]));
});

test("a road shorter than one spacing has no dots, and a road with one point none either", () => {
	assert.equal(dotsAlong([at(0, 0), at(20, 0)]).length, 0);
	assert.equal(dotsAlong([at(0, 0)]).length, 0);
});

test("two roads meeting at a junction do not put dots on top of each other", () => {
	const dots = dotsFromWays([road(200), [...at(100, 0), ...at(100, 200)], [...at(100, -200), ...at(100, 0)]]);
	for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) assert.ok(distanceM(dots[i].pos, dots[j].pos) > 10, `dots ${i} and ${j} are ${distanceM(dots[i].pos, dots[j].pos).toFixed(1)} m apart`);
});

test("the same road in two tiles gives the same dots, so each is only once and keeps its id", () => {
	const a = dotsFromWays([road(300)]);
	const b = dotsFromWays([road(300), road(300)]);
	assert.deepEqual(a.map(dot => dot.id), b.map(dot => dot.id));
	assert.equal(new Set(a.map(dot => dot.id)).size, a.length);
	const game = new Pacman();
	game.addTile("one", a);
	game.addTile("two", a);
	assert.equal(game.dotsNear(at(150, 0), 500, NOW).length, a.length);
	// Letting one tile go keeps the dots the other still holds.
	game.removeTile("one");
	assert.equal(game.dotsNear(at(150, 0), 500, NOW).length, a.length);
	game.removeTile("two");
	assert.equal(game.dotsNear(at(150, 0), 500, NOW).length, 0);
});

test("a dot's id is stable and its pellets are rare and the same every time", () => {
	assert.equal(dotId(at(40, 10)), dotId(at(40, 10)));
	assert.notEqual(dotId(at(40, 10)), dotId(at(80, 10)));
	const dots = dotsFromWays([road(30_000)]);
	const pellets = dots.filter(dot => dot.pellet).length;
	assert.ok(pellets > dots.length / 80 && pellets < dots.length / 15, `${pellets} of ${dots.length}`);
	assert.deepEqual(dotsFromWays([road(30_000)]).filter(dot => dot.pellet).map(dot => dot.id), dots.filter(dot => dot.pellet).map(dot => dot.id));
});

test("driving along a road eats its dots, once, and scores them", () => {
	const game = gameWith([road(300)]);
	const total = game.dotsNear(at(150, 0), 500, NOW).length;
	let eaten = 0;
	let last = null;
	for (let east = 0; east <= 300; east += 14) { const here = at(east, 0); eaten += game.eatAlong(last, here, NOW).eaten.length; last = here; }
	assert.equal(eaten, total);
	assert.equal(game.dotsEaten, total);
	assert.equal(game.dotsNear(at(150, 0), 500, NOW).length, 0);
	// Going back over it eats nothing more.
	assert.equal(game.eatAlong(at(300, 0), at(0, 0), NOW).eaten.length, 0);
	assert.ok(game.score >= total * POINTS_DOT);
});

test("a fast car does not skip dots between two fixes", () => {
	const game = gameWith([road(300)]);
	const total = game.dotsNear(at(150, 0), 500, NOW).length;
	// 100 km/h with one fix a second is a fix every 28 m, then a long gap of 90 m.
	let eaten = 0, last = null;
	for (const east of [0, 28, 56, 84, 112, 202, 230, 258, 286, 300]) { const here = at(east, 0); eaten += game.eatAlong(last, here, NOW).eaten.length; last = here; }
	assert.equal(eaten, total);
});

test("a road the car only passes alongside is eaten only within reach", () => {
	const game = gameWith([road(300)]);
	assert.equal(drive(game, 0, 300, NOW, EAT_RADIUS_M + 15), 0);
	assert.ok(drive(game, 0, 300, NOW, EAT_RADIUS_M - 8) > 5);
});

test("a gap in the GPS does not eat the dots between its two ends", () => {
	const game = gameWith([road(2_000)]);
	const result = game.eatAlong(at(0, 0), at(1_500, 0), NOW);
	assert.ok(result.eaten.length <= 2, `${result.eaten.length}`);
});

test("eaten dots grow back after the chosen time, or never", () => {
	for (const [regrow, ms] of [["day", DAY], ["week", 7 * DAY], ["month", 30 * DAY]]) {
		const game = gameWith([road(300)], regrow);
		const total = game.dotsNear(at(150, 0), 500, NOW).length;
		drive(game, 0, 300, NOW);
		assert.equal(game.dotsNear(at(150, 0), 500, NOW + ms - 60_000).length, 0, regrow);
		assert.equal(game.dotsNear(at(150, 0), 500, NOW + ms).length, total, regrow);
	}
	const never = gameWith([road(300)], "never");
	drive(never, 0, 300, NOW);
	assert.equal(never.dotsNear(at(150, 0), 500, NOW + 3650 * DAY).length, 0);
	assert.equal(REGROW_MS.never, null);
});

test("changing the regrow time applies to dots already eaten", () => {
	const game = gameWith([road(300)], "month");
	drive(game, 0, 300, NOW);
	assert.equal(game.dotsNear(at(150, 0), 500, NOW + 2 * DAY).length, 0);
	game.regrow = "day";
	assert.ok(game.dotsNear(at(150, 0), 500, NOW + 2 * DAY).length > 5);
});

test("a run of dots builds a multiplier, and ends after a pause", () => {
	assert.deepEqual([0, 49, 50, 149, 150, 400].map(multiplierFor), [1, 1, 2, 3, 4, 5]);
	const game = gameWith([road(3_000)]);
	drive(game, 0, 1_400, NOW);
	assert.equal(game.streak, game.dotsEaten);
	assert.ok(game.bestStreak >= 40);
	const before = game.score;
	// A pause longer than the gap starts a new run: the first dots after it are worth one each again.
	const resumeAt = NOW + STREAK_GAP_MS + 1_000;
	drive(game, 1_400, 1_440, resumeAt);
	assert.ok(game.streak >= 1 && game.streak < 5, `${game.streak}`);
	assert.ok(game.score > before);
	assert.ok(game.bestStreak > game.streak);
	assert.equal(game.summary(NOW + 10 * STREAK_GAP_MS).streak, 0);
});

test("score is points per dot times the multiplier, big dots more", () => {
	const game = gameWith([road(3_000)]);
	// One fix at a time, so each dot's points are known.
	let last = at(0, 0), points = 0, index = 0, pellets = 0;
	for (let east = 14; east <= 3_000; east += 14) {
		const here = at(east, 0);
		for (const dot of game.eatAlong(last, here, NOW).eaten) { points += (dot.pellet ? 50 : 10) * multiplierFor(++index); if (dot.pellet) pellets++; }
		last = here;
	}
	assert.equal(game.score, points);
	assert.equal(game.dotsEaten, index);
	assert.equal(game.pelletsEaten, pellets);
	assert.ok(pellets > 0 && game.score > index * 10);
});

test("a dot is only eaten when the car is nearly on it, not as it approaches", () => {
	assert.ok(EAT_RADIUS_M <= 10);
	const game = gameWith([road(300)]);
	const first = dotsFromWays([road(300)])[0];
	// Stopped just short of the first dot (further than the eating distance): nothing is eaten.
	const short = at(15 - (EAT_RADIUS_M + 2), 0);
	assert.equal(game.eatAlong(at(0, 0), short, NOW).eaten.length, 0);
	assert.ok(distanceM(short, first.pos) > EAT_RADIUS_M);
	// Rolling on until it is on the dot eats it.
	assert.equal(game.eatAlong(short, at(15, 0), NOW).eaten.length, 1);
});

test("the pellet's own points are reported, apart from the plain dots eaten with it", () => {
	const game = gameWith([road(6_000)]);
	let found = null, last = at(0, 0);
	for (let east = 14; east <= 6_000 && !found; east += 14) { const here = at(east, 0); const result = game.eatAlong(last, here, NOW); last = here; if (result.pellets) found = result; }
	assert.ok(found, "a big dot within 6 km");
	assert.equal(found.pelletPoints, 50 * found.multiplier);
	assert.ok(found.points >= found.pelletPoints);
});

test("stats count today's dots and the best day", () => {
	const game = gameWith([road(600)], "day");
	const first = drive(game, 0, 300, NOW);
	assert.equal(game.summary(NOW).today, first);
	const second = drive(game, 300, 600, NOW + DAY * 2);
	const summary = game.summary(NOW + DAY * 2);
	assert.equal(summary.today, second);
	assert.equal(summary.bestDay, Math.max(first, second));
	assert.equal(summary.dots, first + second);
});

test("a save round-trips, leaves out dots that have grown back, and tolerates damage", () => {
	const game = gameWith([road(600)], "day");
	drive(game, 0, 300, NOW);
	drive(game, 300, 600, NOW + 2 * DAY);
	const saved = JSON.parse(JSON.stringify(game.toJSON(NOW + 2 * DAY + 60_000)));
	// The first stretch has grown back, so only the second is in the save.
	assert.equal(saved.eaten.length / 2, game.summary(NOW + 2 * DAY).today);
	const loaded = Pacman.fromJSON(saved, "day");
	loaded.addTile("t", dotsFromWays([road(600)]));
	assert.equal(loaded.score, game.score);
	assert.equal(loaded.dotsEaten, game.dotsEaten);
	const left = loaded.dotsNear(at(300, 0), 1_000, NOW + 2 * DAY + 60_000);
	assert.ok(left.every(dot => distanceM(dot.pos, at(0, 0)) < 305), "the second stretch stays eaten");
	assert.ok(left.length > 5, "the first stretch is back");
	assert.equal(Pacman.canRead(null), false);
	assert.equal(Pacman.canRead({ version: 2, eaten: [] }), false);
	assert.equal(Pacman.fromJSON({ nonsense: true }).score, 0);
	assert.equal(Pacman.fromJSON({ version: 1, eaten: [1, "x", NaN, 5], score: -4, dots: "many" }).score, 0);
});

test("starting again clears the score and the eaten dots", () => {
	const game = gameWith([road(300)]);
	const total = game.dotsNear(at(150, 0), 500, NOW).length;
	drive(game, 0, 300, NOW);
	game.reset();
	assert.equal(game.score, 0);
	assert.equal(game.dotsEaten, 0);
	assert.equal(game.dotsNear(at(150, 0), 500, NOW).length, total);
});

test("tiles are zoom 14 map tiles, and a position is inside its own tile's edges", () => {
	assert.deepEqual(tileOf([172.60685, -43.45389]), [16047, 10392]);
	assert.equal(tileKey(1, -2), "1,-2");
	for (const pos of [at(0, 0), at(900, -400), [0.01, 0.01], [-122.4, 37.8], [174.76, -36.85]]) {
		const [tx, ty] = tileOf(pos);
		const [west, south, east, north] = tileBounds(tx, ty);
		assert.ok(pos[0] >= west && pos[0] < east && pos[1] >= south && pos[1] < north, `${pos} in tile ${tx},${ty}`);
		assert.ok(east - west > 0.02 && east - west < 0.03, "about 0.022 degrees across");
	}
});

test("the tiles round a view: its own first, then the nearest, and only those the circle touches", () => {
	const centre = at(0, 0);
	const [cx, cy] = tileOf(centre);
	const small = tilesAround(centre, 300);
	assert.deepEqual(small[0], [cx, cy]);
	assert.ok(small.length >= 1 && small.length <= 4, `${small.length}`);
	const big = tilesAround(centre, 4_000);
	assert.deepEqual(big[0], [cx, cy]);
	assert.ok(big.length > 6, `${big.length}`);
	for (const [tx, ty] of big) assert.ok(Math.abs(tx - cx) <= 3 && Math.abs(ty - cy) <= 3);
	assert.equal(tilesAround(centre, 4_000, 5).length, 5);
	// Every tile within the circle's reach is there, including one to the east and one to the north.
	assert.ok(big.some(([tx, ty]) => tx === cx + 1 && ty === cy) && big.some(([tx, ty]) => tx === cx && ty === cy - 1));
});

test("a road across a tile edge gives each tile only its own dots, and none twice", () => {
	const [tx, ty] = tileOf(at(0, 0));
	const [west, , east] = tileBounds(tx, ty);
	const midLat = ORIGIN[1];
	// A road running straight across three tiles, east to west.
	const road3 = [west - (east - west), midLat, east + (east - west), midLat];
	const here = dotsFromWays([road3], tileBounds(tx, ty));
	const before = dotsFromWays([road3], tileBounds(tx - 1, ty));
	const after = dotsFromWays([road3], tileBounds(tx + 1, ty));
	assert.ok(here.length > 50 && before.length > 50 && after.length > 50);
	assert.ok(here.every(dot => dot.pos[0] >= west && dot.pos[0] < east));
	const everything = dotsFromWays([road3]);
	const ids = [...here, ...before, ...after].map(dot => dot.id);
	assert.equal(new Set(ids).size, ids.length, "no dot is in two tiles");
	assert.ok(ids.length <= everything.length && ids.length > everything.length * 0.6);
});

test("game modes: one of three, with Fog of War carried over from its old switch", () => {
	assert.deepEqual(GAME_MODES.map(mode => mode.id), ["off", "fog", "pacman"]);
	assert.equal(isGameMode("pacman"), true);
	assert.equal(isGameMode("tetris"), false);
	assert.equal(initialGameMode({ getItem: () => "true" }), "fog");
	assert.equal(initialGameMode({ getItem: () => "false" }), "off");
	assert.equal(initialGameMode({ getItem: () => null }), "off");
	assert.equal(initialGameMode(null), "off");
});

test("the dots layer's local metres land on the map's own Mercator coordinates, even several kilometres from its anchor", () => {
	// The map: Mercator x and y in the unit square, and the scale from there to metres at the anchor's latitude.
	const merc = ([lng, lat]) => [(lng + 180) / 360, 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)];
	const worldMetres = 40_075_016.686;
	const anchor = [172.61, -43.456];
	const [ax, ay] = merc(anchor), perMetre = 1 / (worldMetres * Math.cos((anchor[1] * Math.PI) / 180));
	for (const [east, north] of [[0, 0], [3_000, 0], [0, 3_000], [-3_000, -3_000], [2_500, -4_000], [-4_000, 2_000]]) {
		const pos = [anchor[0] + east / (MERCATOR_M_PER_DEGREE * Math.cos((anchor[1] * Math.PI) / 180)), anchor[1] + north / MERCATOR_M_PER_DEGREE];
		const [x, y] = toLocalMetres(anchor, pos);
		// What the layer draws at (x, y): the anchor plus that many metres (north is up, which is a smaller Mercator y).
		const drawn = [ax + x * perMetre, ay - y * perMetre], truth = merc(pos);
		const wrongBy = Math.hypot(drawn[0] - truth[0], drawn[1] - truth[1]) / perMetre;
		assert.ok(wrongBy < 2.5, `${east},${north}: ${wrongBy.toFixed(2)} m out`);
		// With the equator's degree of latitude (110,540 m), the same dots would be out by about 0.7% of their distance.
		const old = [ax + x * perMetre, ay - (north / 110_540 * MERCATOR_M_PER_DEGREE) * perMetre];
		if (Math.abs(north) >= 3_000) assert.ok(Math.hypot(old[0] - truth[0], old[1] - truth[1]) / perMetre > 15);
	}
});
