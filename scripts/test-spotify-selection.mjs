import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/spotifySelection.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { playLikedSelection } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
test("the chosen song starts alone before later songs are queued", async () => {
 const calls = [];
 await playLikedSelection(["chosen", "next", "later"], async uri => calls.push(["play", uri]), async uri => calls.push(["queue", uri]));
 assert.deepEqual(calls, [["play", "chosen"], ["queue", "next"], ["queue", "later"]]);
});
test("a failed play never changes the queue", async () => {
 const calls = [];
 await assert.rejects(playLikedSelection(["chosen", "next"], async () => { throw new Error("offline"); }, async uri => calls.push(uri)));
 assert.deepEqual(calls, []);
});
