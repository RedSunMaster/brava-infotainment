import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const load = async name => {
	const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
	const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
	return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
};
const { VoiceQueue } = await load("voiceQueue");
const { spokenDistance } = await load("spokenDistance");

test("the phrase being spoken now goes ahead of background preparation", () => {
	const queue = new VoiceQueue();
	queue.push("prepare later turn", 12);
	queue.push("prepare next turn", 10);
	queue.push("speak now", 0);
	queue.push("prepare next turn, second", 10);
	assert.deepEqual([queue.next(), queue.next(), queue.next(), queue.next(), queue.next()], ["speak now", "prepare next turn", "prepare next turn, second", "prepare later turn", undefined]);
});
test("a waiting phrase can be promoted when it becomes urgent, but never demoted", () => {
	const queue = new VoiceQueue();
	queue.push({ id: 1 }, 10);
	queue.push({ id: 2 }, 10);
	assert.equal(queue.promote(job => job.id === 2, 0), true);
	assert.equal(queue.promote(job => job.id === 9, 0), false);
	assert.equal(queue.promote(job => job.id === 2, 50), true);
	assert.equal(queue.next().id, 2);
	assert.equal(queue.size, 1);
	queue.clear();
	assert.equal(queue.size, 0);
});
test("distances are spoken in a small set of natural phrases that can be reused", () => {
	assert.equal(spokenDistance(87), "In 90 metres,");
	assert.equal(spokenDistance(196), "In 200 metres,");
	assert.equal(spokenDistance(224), "In 200 metres,");
	assert.equal(spokenDistance(226), "In 250 metres,");
	assert.equal(spokenDistance(480), "In 500 metres,");
	assert.equal(spokenDistance(640), "In 600 metres,");
	assert.equal(spokenDistance(990), "In 900 metres,");
	assert.equal(spokenDistance(1040), "In 1 kilometre,");
	assert.equal(spokenDistance(1300), "In 1.5 kilometres,");
	assert.equal(spokenDistance(4600), "In 4.5 kilometres,");
	assert.equal(spokenDistance(12400), "In 12 kilometres,");
	const phrases = new Set(Array.from({ length: 1000 }, (_, i) => spokenDistance(81 + i * 2)));
	assert.ok(phrases.size < 25, `only ${phrases.size} distinct phrases`);
});
