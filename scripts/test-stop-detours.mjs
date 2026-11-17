import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/stopDetours.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
const { detourSeconds, formatDetour, rankByDetour } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
// Index 0 = you, 1..2 = candidates, 3 = destination. Direct trip takes 600 s.
const matrix = [[0, 300, 400, 600], [300, 0, 100, 450], [400, 100, 0, 250], [600, 450, 250, 0]];

test("detour is the extra time for going via the stop", () => {
	assert.deepEqual(detourSeconds(matrix), [150, 50]);
	// A stop that is faster to reach directly than the direct trip never has a negative detour.
	assert.deepEqual(detourSeconds([[0, 100, 300], [100, 0, 90], [300, 90, 0]]), [0]);
});
test("unreachable stops have no detour instead of a wrong one", () => {
	assert.deepEqual(detourSeconds([[0, null, 600], [null, 0, 50], [600, 50, 0]]), [null]);
	assert.deepEqual(detourSeconds([[0, 100, null], [100, 0, 50], [null, 50, 0]]), [null]);
});
test("labels read naturally", () => {
	assert.equal(formatDetour(10), "On the way");
	assert.equal(formatDetour(44), "On the way");
	assert.equal(formatDetour(90), "+2 min");
	assert.equal(formatDetour(null), "");
});
test("results are ranked by detour and fall back to their original order if Matrix fails", async () => {
	const place = (id, lng) => ({ id, name: id, address: "", kind: "x", source: "searchbox", coords: [lng, -43.5] });
	const original = globalThis.fetch;
	try {
		let asked;
		globalThis.fetch = async url => { asked = String(url); return Response.json({ durations: matrix }); };
		const ranked = await rankByDetour([place("far", 172.1), place("near", 172.2)], [172, -43.5], [173, -43.5], "token", new AbortController().signal);
		assert.deepEqual(ranked.map(item => [item.id, item.detourSeconds]), [["near", 50], ["far", 150]]);
		assert.match(asked, /directions-matrix\/v1\/mapbox\/driving-traffic\/172,-43.5;172.1,-43.5;172.2,-43.5;173,-43.5/);
		globalThis.fetch = async () => new Response("no", { status: 500 });
		const fallback = await rankByDetour([place("a", 172.1), place("b", 172.2)], [172, -43.5], [173, -43.5], "token", new AbortController().signal);
		assert.deepEqual(fallback.map(item => item.id), ["a", "b"]);
		assert.equal(fallback[0].detourSeconds, undefined);
	} finally { globalThis.fetch = original; }
});
