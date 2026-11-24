import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
async function compile(name, links = {}) {
	const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
	let compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
	for (const [from, url] of Object.entries(links)) compiled = compiled.replaceAll(`"./${from}"`, JSON.stringify(url));
	return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}
const explorationUrl = await compile("exploration");
const spritesUrl = await compile("fruitSprites");
const { FruitBonus, fruitSpots, fruitForStreak, passesNear, FRUIT_EVERY, FRUIT_LIFETIME_MS, FRUIT_POINTS } = await import(await compile("fruit", { exploration: explorationUrl, fruitSprites: spritesUrl }));
const { FRUIT_SPRITES } = await import(spritesUrl);

const ORIGIN = [172.6, -43.5];
const M_LNG = 1 / (111_195 * Math.cos((ORIGIN[1] * Math.PI) / 180)), M_LAT = 1 / 111_195;
const at = (east, north) => [ORIGIN[0] + east * M_LNG, ORIGIN[1] + north * M_LAT];

test("the eight fruit have the arcade's points and each sprite is 16 by 16 with colours from its palette", () => {
	assert.deepEqual([...FRUIT_POINTS], [100, 300, 500, 700, 1000, 2000, 3000, 5000]);
	for (const sprite of FRUIT_SPRITES) {
		assert.equal(sprite.rows.length, 16, sprite.name);
		for (const row of sprite.rows) { assert.equal(row.length, 16); for (const ch of row) assert.ok(ch === "." || ch.charCodeAt(0) - 97 < sprite.palette.length, sprite.name); }
		assert.ok(sprite.rows.join("").replaceAll(".", "").length > 40, `${sprite.name} has something drawn`);
	}
});

test("better runs earn better fruit, up to the key", () => {
	assert.equal(fruitForStreak(0), 0);
	assert.equal(fruitForStreak(69), 0);
	assert.equal(fruitForStreak(70), 1);
	assert.equal(fruitForStreak(210), 3);
	assert.equal(fruitForStreak(5_000), 7);
});

test("a fruit is due after enough dots, and only one waits at a time", () => {
	const fruit = new FruitBonus();
	fruit.addDots(FRUIT_EVERY - 1);
	assert.equal(fruit.due, false);
	fruit.addDots(1);
	assert.equal(fruit.due, true);
	const placed = fruit.spawn([at(200, 0)], 0, 1_000, () => 0);
	assert.ok(placed);
	assert.equal(placed.expiresAt, 1_000 + FRUIT_LIFETIME_MS);
	fruit.addDots(500);
	assert.equal(fruit.due, false, "one is already waiting");
});

test("with nowhere to put it, the fruit stays due and is tried again", () => {
	const fruit = new FruitBonus();
	fruit.addDots(FRUIT_EVERY);
	assert.equal(fruit.spawn([], 0, 0), null);
	assert.equal(fruit.due, true);
});

test("spots are on the road ahead, not too near or far, nor behind", () => {
	const car = at(0, 0);
	const spots = fruitSpots(car, 90, [at(50, 0), at(200, 0), at(200, 30), at(-200, 0), at(0, 200), at(600, 0)]);
	assert.deepEqual(spots, [at(200, 0), at(200, 30)]);
	assert.equal(fruitSpots(car, null, [at(-200, 0), at(200, 0)]).length, 2, "no heading: either side");
});

test("driving through a fruit eats it; passing it by does not", () => {
	const fruit = new FruitBonus();
	fruit.addDots(FRUIT_EVERY);
	fruit.spawn([at(200, 0)], 140, 0, () => 0);
	assert.equal(fruit.collect(at(0, 30), at(100, 30), 1), null, "30 m to the side");
	assert.equal(fruit.collect(at(120, 0), at(170, 0), 1), null, "stopped 30 m short");
	const got = fruit.collect(at(150, 0), at(260, 0), 1);
	assert.deepEqual(got, { kind: 2, points: 500 }, "fast fix right over it");
	assert.equal(fruit.live, null);
	assert.equal(fruit.collect(at(150, 0), at(260, 0), 2), null, "gone");
});

test("a fruit nobody eats goes away, and cannot be eaten after", () => {
	const fruit = new FruitBonus();
	fruit.addDots(FRUIT_EVERY);
	fruit.spawn([at(200, 0)], 0, 0, () => 0);
	assert.equal(fruit.expire(FRUIT_LIFETIME_MS - 1), false);
	assert.equal(fruit.collect(at(190, 0), at(210, 0), FRUIT_LIFETIME_MS), null, "too late");
	assert.equal(fruit.expire(FRUIT_LIFETIME_MS), true);
	assert.equal(fruit.live, null);
});

test("passesNear measures to the segment, not the line", () => {
	assert.equal(passesNear(at(0, 0), at(100, 0), at(150, 0), 14), false);
	assert.equal(passesNear(at(0, 0), at(100, 0), at(50, 10), 14), true);
	assert.equal(passesNear(null, at(100, 0), at(105, 0), 14), true);
});
