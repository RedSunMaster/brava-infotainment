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
const graphUrl = await compile("roadGraph", { exploration: explorationUrl });
const { RoadGraph, distance, JOIN_M } = await import(graphUrl);
const { GhostPack, GHOST_NAMES, CATCH_M, SPAWN_MIN_M, SPAWN_MAX_M, SPEED_FACTOR, RESPAWN_S, EATEN_RESPAWN_S, LOSE_M, RELEASE_S, RECYCLE_M, RECYCLE_AFTER_S, RUBBER_FROM_M, FRIGHT_S, FLASH_LAST_S, FRIGHT_SPEED, EATEN_POINTS } = await import(await compile("ghosts", { exploration: explorationUrl, roadGraph: graphUrl }));
const { GHOST_SPRITES, FRIGHTENED_SPRITES, PACMAN_FRAMES, GHOST_COLOURS, DOT_SPRITE, POWER_PELLET_SPRITE, PELLET_COLOUR } = await import(await compile("sprites"));
const { Pacman, GHOST_PENALTY, dotsFromWays } = await import(await compile("pacman", { exploration: explorationUrl }));

const ORIGIN = [172.60685, -43.45389];
const M_LAT = 1 / 110_540;
const M_LNG = 1 / (111_320 * Math.cos((ORIGIN[1] * Math.PI) / 180));
/** A point east/north of the origin, in metres. */
const at = (east, north) => [ORIGIN[0] + east * M_LNG, ORIGIN[1] + north * M_LAT];
/** A road through [east, north] corners, as the flat lng, lat list the main process sends. */
const road = (...corners) => corners.flatMap(([e, n]) => at(e, n));
const graphOf = (...ways) => { const g = new RoadGraph(); g.addWays(ways); return g; };
/** A lattice of streets, `blocks` blocks each way, `size` metres apart. */
const lattice = (blocks, size) => {
	const ways = [];
	for (let i = 0; i <= blocks; i++) { ways.push(road([0, i * size], [blocks * size, i * size])); ways.push(road([i * size, 0], [i * size, blocks * size])); }
	return graphOf(...ways);
};
const count = graph => { const seen = new Set(); let parts = 0; for (let s = 0; s < graph.size; s++) { if (seen.has(s)) continue; parts++; const stack = [s]; seen.add(s); while (stack.length) { const a = stack.pop(); for (const e of graph.adj[a]) if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to); } } } return parts; };

test("long stretches are cut into short pieces, so nothing is far from a node", () => {
	const graph = graphOf(road([0, 0], [300, 0]));
	assert.ok(graph.size >= 30);
	for (let i = 0; i < graph.size; i++) for (const edge of graph.adj[i]) assert.ok(edge.len <= 10.5, `${edge.len}`);
});

test("roads that share a point are one network; the same road from two tiles is not doubled", () => {
	const crossing = lattice(3, 100);
	assert.equal(count(crossing), 1);
	const twice = graphOf(road([0, 0], [200, 0]), road([0, 0], [200, 0]));
	const once = graphOf(road([0, 0], [200, 0]));
	assert.equal(twice.size, once.size);
	assert.equal(twice.adj.reduce((n, list) => n + list.length, 0), once.adj.reduce((n, list) => n + list.length, 0));
});

test("a side street that stops just short of the main road is joined to it", () => {
	const graph = graphOf(road([0, 0], [200, 0]), road([100, 60], [100, 5]));
	assert.ok(JOIN_M >= 5);
	assert.equal(count(graph), 1);
	// But one that stops well short is not.
	assert.equal(count(graphOf(road([0, 0], [200, 0]), road([100, 60], [100, 25]))), 2);
});

test("a bridge over another road does not join it", () => {
	const graph = graphOf(road([0, 0], [200, 0]), road([100, -100], [100, 100]));
	assert.equal(count(graph), 2);
});

test("road distances and the nearest node", () => {
	const graph = lattice(4, 100);
	const start = graph.nearest(at(0, 0), 30);
	assert.notEqual(start, null);
	const reach = graph.reach(start, 2_000);
	const far = graph.nearest(at(400, 400), 30);
	assert.ok(Math.abs(reach.dist.get(far) - 800) < 15, `${reach.dist.get(far)}`);
	assert.equal(graph.nearest(at(5_000, 5_000), 60), null);
	// The search stops at its limit.
	assert.equal(graph.reach(start, 150).dist.has(far), false);
});

/** One ghost (Blinky) alone: `update` says whether it caught the car, `place` where it is. */
function solo(graph, random) {
	const pack = new GhostPack(graph, { names: ["blinky"], random });
	return { pack, update: (...args) => pack.update(...args).some(event => event.type === "caught"), place: () => pack.place() };
}

/** A straight road, long enough for a ghost, with the car on it. */
const straight = (length = 4_000) => graphOf(road([0, 0], [length, 0]));
const car = (east, speed = 14, bearing = 90) => ({ pos: at(east, 0), speed, bearing });

test("a ghost starts 500 to 800 m ahead of a moving car, and not for a car that is crawling", () => {
	const hunt = solo(straight(), () => 0.5);
	assert.equal(hunt.update(0.1, car(1_000, 1), 0), false);
	assert.equal(hunt.place(), null, "not for a car at walking pace");
	hunt.update(0.1, car(1_000), 1);
	const place = hunt.place();
	assert.ok(place);
	const away = distance(place.pos, at(1_000, 0));
	assert.ok(away >= SPAWN_MIN_M - 12 && away <= SPAWN_MAX_M + 12, `${away}`);
	assert.ok(place.pos[0] > at(1_000, 0)[0], "ahead of a car heading east");
});

test("a ghost chases down the road, faster than the car when it is a long way off", () => {
	const hunt = solo(straight(), () => 0.5);
	hunt.update(0.1, car(1_000, 0), 0);
	hunt.update(0.1, car(1_000), 1);
	const start = hunt.place().pos;
	// The car sits at the same spot at 20 m/s; the ghost closes in, at the car's speed to twice it (the further off, the faster).
	let time = 1;
	for (let i = 0; i < 100; i++) { time += 0.1; hunt.update(0.1, car(1_000, 20), time); }
	const moved = distance(start, hunt.place().pos);
	assert.ok(moved > 10 * 20 * SPEED_FACTOR.blinky - 5 && moved <= 10 * 28 + 1, `${moved}`);
	assert.ok(hunt.place().pos[0] < start[0], "towards the car");
	assert.ok(Math.abs(hunt.place().bearing - 270) < 5, "facing the way it goes (west)");
});

test("a ghost stands still while the car is stopped", () => {
	const hunt = solo(straight(), () => 0.5);
	hunt.update(0.1, car(1_000, 0), 0);
	hunt.update(0.1, car(1_000), 1);
	const start = hunt.place().pos;
	for (let i = 0; i < 100; i++) hunt.update(0.1, car(1_000, 0), 2 + i * 0.1);
	assert.deepEqual(hunt.place().pos, start);
});

test("a faster car does not get away: the ghost is quicker the quicker the car is", () => {
	const run = speed => {
		const hunt = solo(straight(), () => 0.5);
		hunt.update(0.1, car(1_000, 0), 0);
		hunt.update(0.1, car(1_000, speed), 1);
		const start = hunt.place().pos;
		for (let i = 0; i < 50; i++) hunt.update(0.1, car(1_000, speed), 2 + i * 0.1);
		return distance(start, hunt.place().pos);
	};
	const slow = run(6), fast = run(12);
	assert.ok(Math.abs(fast / slow - 2) < 0.25, `${slow} ${fast}`);
});

test("the ghost catches a car it meets, which sends it away for a while", () => {
	const hunt = solo(straight(), () => 0.5);
	let eastCar = 1_000, time = 0, caught = false;
	hunt.update(0.1, car(eastCar, 14), time);
	for (let i = 0; i < 1_000 && !caught; i++) {
		time += 0.1;
		eastCar += 1.4;
		caught = hunt.update(0.1, car(eastCar, 14), time);
	}
	assert.ok(caught, "met within a minute");
	assert.ok(time < 45, `${time}`);
	assert.equal(hunt.place(), null);
	// It stays away for RESPAWN_S, then a new one starts.
	hunt.update(0.1, car(eastCar, 14), time + 5);
	assert.equal(hunt.place(), null);
	hunt.update(0.1, car(eastCar, 14), time + RESPAWN_S + 1);
	assert.ok(hunt.place());
	assert.ok(CATCH_M > 8 && CATCH_M < 20);
});

test("a ghost on a road the car cannot reach, or left far behind, is let go and a new one comes later", () => {
	const hunt = solo(straight(9_000), () => 0.5);
	hunt.update(0.1, car(1_000, 0), 0);
	hunt.update(0.1, car(1_000), 1);
	assert.ok(hunt.place());
	// The car is suddenly far away (a GPS jump) on the same road: the ghost is beyond reach.
	const jumped = car(1_000 + LOSE_M + 800);
	hunt.update(0.1, jumped, 2);
	assert.equal(hunt.place(), null);
	hunt.update(0.1, jumped, 3);
	assert.equal(hunt.place(), null, "not at once");
	hunt.update(0.1, jumped, 10);
	assert.ok(hunt.place());
});

test("a car away from any road is not chased", () => {
	const hunt = solo(straight(), () => 0.5);
	assert.equal(hunt.update(0.1, { pos: at(1_000, 500), speed: 14, bearing: 90 }, 0), false);
	assert.equal(hunt.place(), null);
});

test("on a lattice the ghost finds its way round corners to the car", () => {
	const hunt = solo(lattice(12, 100), () => 0.3);
	const where = { pos: at(0, 0), speed: 0, bearing: 90 };
	hunt.update(0.1, { ...where, speed: 14 }, 0);
	const start = hunt.place();
	assert.ok(start);
	const before = distance(start.pos, where.pos);
	for (let i = 0; i < 80; i++) hunt.update(0.1, { ...where, speed: 14 }, 1 + i * 0.1);
	const after = distance(hunt.place().pos, where.pos);
	assert.ok(after < before - 80, `${before} -> ${after}`);
});

test("a caught car loses its run and some points, never going below nothing, and the count is saved", () => {
	const game = new Pacman();
	game.addTile("t", dotsFromWays([road([0, 0], [600, 0])]));
	let last = at(0, 0);
	for (let east = 14; east <= 600; east += 14) { const here = at(east, 0); game.eatAlong(last, here, 1_000); last = here; }
	const before = game.summary(1_000);
	assert.ok(before.score > GHOST_PENALTY && before.streak > 10);
	const lost = game.caughtByGhost();
	assert.equal(lost, GHOST_PENALTY);
	const after = game.summary(1_000);
	assert.equal(after.score, before.score - GHOST_PENALTY);
	assert.equal(after.streak, 0);
	assert.equal(after.caught, 1);
	assert.equal(after.bestStreak, before.bestStreak, "the best run stays");
	const again = Pacman.fromJSON(JSON.parse(JSON.stringify(game.toJSON(1_000))));
	assert.equal(again.summary(1_000).caught, 1);
	assert.equal(new Pacman().caughtByGhost(), 0, "nothing to lose");
	game.reset();
	assert.equal(game.summary(1_000).caught, 0);
});

test("the arcade sprites are whole: ghosts 14 by 14, Pac-Man 13 by 13, only the known marks, in the frames the models expect", () => {
	const drawn = sprite => sprite.rows.join("");
	const ghosts = [...Object.values(GHOST_SPRITES).flat(), ...FRIGHTENED_SPRITES.blue, ...FRIGHTENED_SPRITES.white];
	assert.equal(Object.keys(GHOST_SPRITES).sort().join(), "down,left,right,up");
	for (const direction of Object.values(GHOST_SPRITES)) assert.equal(direction.length, 2, "two foot positions each");
	for (const sprite of ghosts) { assert.equal(sprite.rows.length, 14); assert.ok(sprite.rows.every(row => row.length === 14)); assert.match(drawn(sprite), /^[.XWP]+$/); }
	// A ghost looking each way has pupils (P) inside its eyes, on the side it looks to.
	const pupilsAt = sprite => { const cells = []; sprite.rows.forEach((row, r) => [...row].forEach((c, k) => { if (c === "P") cells.push([k, r]); })); return [cells.reduce((n, c) => n + c[0], 0) / cells.length, cells.reduce((n, c) => n + c[1], 0) / cells.length]; };
	const [rightX] = pupilsAt(GHOST_SPRITES.right[0]), [leftX] = pupilsAt(GHOST_SPRITES.left[0]);
	const [, upY] = pupilsAt(GHOST_SPRITES.up[0]), [, downY] = pupilsAt(GHOST_SPRITES.down[0]);
	assert.ok(rightX > leftX, "pupils further right when looking right");
	assert.ok(upY < downY, "pupils higher when looking up");
	assert.deepEqual(Object.keys(GHOST_COLOURS), ["blinky", "pinky", "inky", "clyde"]);
	assert.equal(GHOST_COLOURS.blinky, 0xff0000);
	// Pac-Man: wide, half, closed, each a 13 by 13 disc facing right, and mirror-symmetric top to bottom.
	assert.equal(PACMAN_FRAMES.length, 3);
	const size = frame => drawn(frame).replace(/[^X]/g, "").length;
	assert.ok(size(PACMAN_FRAMES[0]) < size(PACMAN_FRAMES[1]) && size(PACMAN_FRAMES[1]) < size(PACMAN_FRAMES[2]), "wide < half < closed");
	for (const frame of PACMAN_FRAMES) {
		assert.equal(frame.rows.length, 13);
		assert.ok(frame.rows.every(row => row.length === 13));
		assert.deepEqual(frame.rows, [...frame.rows].reverse(), "the same above and below the mouth");
	}
	// The mouth is on the right: the wide frame has nothing in the middle row's right half and the closed frame is full there.
	assert.ok(!PACMAN_FRAMES[0].rows[6].slice(7).includes("X"));
	assert.ok(PACMAN_FRAMES[2].rows[6].slice(7).split("").every(c => c === "X"));
});

test("the arcade's pellets: a 2 by 2 dot, and an 8 by 8 octagon of a power pellet, in the arcade's peach", () => {
	assert.deepEqual(DOT_SPRITE, ["XX", "XX"]);
	assert.equal(POWER_PELLET_SPRITE.length, 8);
	assert.ok(POWER_PELLET_SPRITE.every(row => row.length === 8 && /^\.*X+\.*$/.test(row)), "each row one run");
	assert.deepEqual(POWER_PELLET_SPRITE, [...POWER_PELLET_SPRITE].reverse(), "the same top and bottom");
	assert.ok(POWER_PELLET_SPRITE.every(row => row === [...row].reverse().join("")), "the same left and right");
	assert.deepEqual(POWER_PELLET_SPRITE.map(row => row.split("").filter(c => c === "X").length), [4, 6, 8, 8, 8, 8, 6, 4]);
	assert.equal(PELLET_COLOUR, 0xfab9b0);
});

/** All four ghosts on a long straight road, and a car driving east along it. */
function drive(pack, { seconds, speed = 14, start = 4_500, step = 0.1, onStep = () => {} }) {
	let east = start, time = 0;
	for (let i = 0; i < seconds / step; i++) {
		time += step; east += speed * step;
		const events = pack.update(step, { pos: at(east, 0), speed, bearing: 90 }, time);
		onStep(time, east, events);
	}
	return { time, east };
}
const road9 = () => straight(9_000);

test("all four ghosts come out, one after another, Blinky and Pinky ahead of the car and Inky and Clyde behind", () => {
	const pack = new GhostPack(road9(), { random: () => 0.37 });
	const firstSeen = {}, where = {};
	drive(pack, { seconds: 40, onStep: (time, east) => { for (const place of pack.places()) if (!(place.name in firstSeen)) { firstSeen[place.name] = time; where[place.name] = distance(place.pos, at(east, 0)) * (place.pos[0] > at(east, 0)[0] ? 1 : -1); } } });
	assert.deepEqual(Object.keys(firstSeen).sort(), [...GHOST_NAMES].sort(), "every ghost appeared");
	for (const name of GHOST_NAMES) assert.ok(Math.abs(firstSeen[name] - (1 + RELEASE_S[name])) < 1.5, `${name} out at ${firstSeen[name]}`);
	assert.ok(firstSeen.blinky < firstSeen.pinky && firstSeen.pinky < firstSeen.inky && firstSeen.inky < firstSeen.clyde, "in turn");
	assert.ok(where.blinky > 0 && where.pinky > 0, "ahead " + JSON.stringify(where));
	assert.ok(where.inky < 0 && where.clyde < 0, "behind " + JSON.stringify(where));
	for (const name of GHOST_NAMES) assert.ok(Math.abs(where[name]) >= SPAWN_MIN_M - 12 && Math.abs(where[name]) <= SPAWN_MAX_M + 12, `${name} ${where[name]}`);
});

test("the ghosts start apart from each other", () => {
	const pack = new GhostPack(road9(), { random: () => 0.5 });
	drive(pack, { seconds: 30, speed: 3.5 });
	const places = pack.places();
	assert.ok(places.length >= 2);
	for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++) assert.ok(distance(places[i].pos, places[j].pos) > 100, `${places[i].name} and ${places[j].name}`);
});

test("on a lattice every ghost works its way to the car, and none ever runs from it while chasing", () => {
	const graph = lattice(14, 100);
	const pack = new GhostPack(graph, { random: () => 0.6 });
	const where = { pos: at(700, 700), speed: 14, bearing: 0 };
	const nearest = {}, start = {}, farthest = {};
	let time = 0;
	for (let i = 0; i < 1_800; i++) {
		time += 0.1;
		pack.update(0.1, where, time);
		for (const place of pack.places()) {
			const d = distance(place.pos, where.pos);
			start[place.name] ??= d;
			nearest[place.name] = Math.min(nearest[place.name] ?? Infinity, d);
			farthest[place.name] = Math.max(farthest[place.name] ?? 0, d - start[place.name]);
		}
	}
	assert.equal(Object.keys(nearest).length, 4, "all four came out");
	for (const name of GHOST_NAMES) assert.ok(nearest[name] < 40, `${name} got no nearer than ${nearest[name].toFixed(0)} m`);
	// Pinky and Inky aim ahead of the car from afar, which may take them a little off the straight way, but never far.
	for (const name of GHOST_NAMES) assert.ok(farthest[name] < 260, `${name} went ${farthest[name].toFixed(0)} m further off`);
});

test("a ghost the car has left behind catches up again (the further behind, the faster)", () => {
	const pack = new GhostPack(road9(), { names: ["inky"], random: () => 0.5 });
	let gap = null, first = null;
	drive(pack, { seconds: 50, speed: 14, onStep: (time, east) => {
		const place = pack.places()[0];
		if (!place) return;
		const d = Math.abs(at(east, 0)[0] - place.pos[0]) / M_LNG;
		first ??= d;
		gap = d;
	} });
	assert.ok(first > 500, `started ${first}`);
	assert.ok(gap < first * 0.5, `still ${gap.toFixed(0)} m behind after 50 s, from ${first.toFixed(0)}`);
	assert.ok(RUBBER_FROM_M < 400);
});

test("a ghost left far behind for a while is brought back in ahead of the car", () => {
	const pack = new GhostPack(road9(), { names: ["blinky"], random: () => 0.5 });
	const east = e => ({ pos: at(e, 0), speed: 14, bearing: 90 });
	pack.update(0.1, east(2_000), 0); pack.update(0.1, east(2_000), 1);
	assert.ok(pack.place(), "out");
	// The car is suddenly 1,700 m further on (so the ghost is far behind it), and stays there.
	let time = 1, gone = null, back = null;
	for (let i = 0; i < 160; i++) {
		time += 0.1;
		pack.update(0.1, east(3_700), time);
		if (!pack.place() && gone === null) gone = time;
		if (gone !== null && pack.place() && back === null) back = time;
	}
	assert.ok(gone !== null && gone - 1 >= RECYCLE_AFTER_S - 0.5 && gone - 1 <= RECYCLE_AFTER_S + 1.5, `taken away at ${gone}`);
	assert.ok(back !== null && back - gone < 3, `back after ${back - gone}`);
	assert.ok(RECYCLE_M >= 500 && pack.place().pos[0] > at(3_700, 0)[0], "ahead of the car again");
});

test("a power pellet turns every ghost blue, then they flash, then they chase again", () => {
	const pack = new GhostPack(road9(), { random: () => 0.37 });
	// Crawling along (so that none reaches the car), long enough for all four to come out.
	drive(pack, { seconds: 30, speed: 3.5 });
	assert.ok(pack.places().length >= 3, "most are out");
	assert.ok(pack.places().every(place => place.mood === "chasing"));
	const moods = [];
	let time = 30;
	pack.frighten(time);
	for (let i = 0; i < (FRIGHT_S + 1) * 10; i++) { time += 0.1; pack.update(0.1, { pos: at(5_000, 0), speed: 0, bearing: 90 }, time); const left = FRIGHT_S - (time - 30); moods.push([left, pack.places()[0].mood]); }
	assert.ok(moods.filter(([left]) => left > FLASH_LAST_S + 0.2).every(([, mood]) => mood === "frightened"), JSON.stringify(moods.slice(0, 5)));
	assert.ok(moods.filter(([left]) => left < FLASH_LAST_S - 0.2 && left > 0.2).every(([, mood]) => mood === "flashing"));
	assert.ok(moods.filter(([left]) => left < -0.2).every(([, mood]) => mood === "chasing"));
	assert.ok(Math.abs(pack.frightenedFor()) < 1e-9);
});

test("blue ghosts turn round at once and wander off at about half speed", () => {
	const run = frightened => {
		const pack = new GhostPack(road9(), { names: ["blinky"], random: () => 0.5 });
		const where = { pos: at(4_500, 0), speed: 14, bearing: 90 };
		pack.update(0.1, where, 0); pack.update(0.1, where, 1);
		const start = pack.place().pos;
		if (frightened) pack.frighten(1);
		let time = 1;
		for (let i = 0; i < 140; i++) { time += 0.1; pack.update(0.1, where, time); }
		return { moved: distance(start, pack.place().pos), away: distance(pack.place().pos, where.pos) - distance(start, where.pos) };
	};
	const chasing = run(false), blue = run(true);
	assert.ok(chasing.away < 0, "a chasing ghost closes in");
	assert.ok(blue.away > 0, "a blue one is turned round, and goes the other way " + JSON.stringify({ chasing, blue }));
	assert.ok(Math.abs(blue.moved - 14 * SPEED_FACTOR.blinky * FRIGHT_SPEED * 14) < 12, `${blue.moved}`);
	assert.ok(chasing.moved > 2 * blue.moved);
});

test("eating blue ghosts: 200 for the first, then 400, and the car is never caught while they are blue", () => {
	const pack = new GhostPack(road9(), { names: ["blinky", "pinky"], random: () => 0.5 });
	const events = [];
	let frightenedAt = null;
	drive(pack, { seconds: 80, start: 4_000, onStep: (time, east, found) => {
		// A power pellet is eaten when a ghost has come within about 60 m, as the arcade's are.
		if (frightenedAt === null && pack.places().some(place => distance(place.pos, at(east, 0)) < 60)) { pack.frighten(time); frightenedAt = time; }
		for (const event of found) events.push({ ...event, time });
	} });
	assert.notEqual(frightenedAt, null, "a ghost came within 60 m");
	const while_blue = events.filter(event => event.time <= frightenedAt + FRIGHT_S);
	assert.ok(!while_blue.some(event => event.type === "caught"), "nothing caught the car while they were blue " + JSON.stringify(while_blue));
	const eaten = while_blue.filter(event => event.type === "eaten");
	assert.ok(eaten.length >= 1, "ate one");
	assert.deepEqual(eaten.map(event => event.points), EATEN_POINTS.slice(0, eaten.length));
});

test("an eaten ghost starts again after a while, and a new power pellet starts the count at 200", () => {
	const pack = new GhostPack(road9(), { names: ["blinky"], random: () => 0.5 });
	const where = { pos: at(4_500, 0), speed: 14, bearing: 90 };
	pack.update(0.1, where, 0); pack.update(0.1, where, 1);
	// Blue, and the car right on it.
	const place = pack.place();
	pack.frighten(1.1);
	const events = pack.update(0.1, { ...where, pos: place.pos }, 1.2);
	assert.deepEqual(events, [{ type: "eaten", name: "blinky", points: 200 }]);
	assert.equal(pack.place(), null);
	pack.update(0.1, where, 1.3 + EATEN_RESPAWN_S - 1);
	assert.equal(pack.place(), null, "not yet");
	pack.update(0.1, where, 1.3 + EATEN_RESPAWN_S + 1);
	assert.ok(pack.place(), "back");
	const again = pack.place();
	pack.frighten(20);
	assert.deepEqual(pack.update(0.1, { ...where, pos: again.pos }, 20.1).map(event => event.points), [200]);
});

test("a ghost that touches the car when it is not blue catches it, and only the one ghost goes", () => {
	const pack = new GhostPack(road9(), { names: ["blinky", "pinky"], random: () => 0.5 });
	let time = 0;
	const where = { pos: at(4_500, 0), speed: 14, bearing: 90 };
	for (let i = 0; i < 200; i++) { time += 0.1; pack.update(0.1, where, time); }
	const places = pack.places();
	assert.equal(places.length, 2);
	const events = pack.update(0.1, { ...where, pos: places[0].pos }, time + 0.1);
	assert.deepEqual(events.map(event => event.type), ["caught"]);
	assert.equal(pack.places().length, 1);
});
