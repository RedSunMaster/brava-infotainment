import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/spotifySelection.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { playLikedSelection, loadLikedUris, likedPlaybackUris, playSelectedWithShuffle } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
test("a liked-song tap plays its Spotify collection offset without reading the library", async () => {
 const calls = [];
 await playLikedSelection("b", async body => calls.push(body), () => assert.fail("read library"));
 assert.deepEqual(calls, [{context_uri: "spotify:collection:tracks", offset: {uri: "b"}}]);
});
test("only an unsupported collection request falls back to the full URI list", async () => {
 const calls = [];
 await playLikedSelection("b", async (body, selected) => {
  if (body.context_uri) throw Object.assign(new Error("unsupported"), {status: 400});
  calls.push([body, selected]);
 }, async () => ["a", "b"]);
 assert.deepEqual(calls, [[{uris: ["b", "a"]}, "b"]]);
 await assert.rejects(playLikedSelection("b", async () => { throw new Error("offline"); }, () => assert.fail("read library")), /offline/);
});
test("loads every page of liked songs and skips unavailable and local tracks", async () => {
 const offsets = [];
 const uris = await loadLikedUris(async offset => {
  offsets.push(offset);
  return offset === 0 ? { items: Array.from({length: 50}, (_, i) => ({track: {uri: `track:${i}`, type: "track"}})), next: "next" } : {items: [{track: {uri: "track:50", type: "track"}}, {track: null}, {track: {uri: "local", type: "track", is_local: true}}], next: null};
 });
 assert.deepEqual(offsets, [0, 50]);
 assert.equal(uris.length, 51);
 assert.equal(uris[50], "track:50");
});
test("fails rather than playing a partial collection when a page is unavailable", async () => {
 await assert.rejects(loadLikedUris(async offset => offset ? null : {items: [{track: {uri: "a", type: "track"}}], next: "next"}), /all liked songs/);
});
test("places the selected track first while retaining the rest of the collection", () => {
 assert.deepEqual(likedPlaybackUris(["a", "b", "c"], "b"), ["b", "a", "c"]);
 assert.deepEqual(likedPlaybackUris(["a", "b"], "missing"), ["a", "b"]);
});
test("waits for the chosen song before restoring shuffle", async () => {
 const calls = [];
 await playSelectedWithShuffle({shuffle: true, setShuffle: async enabled => calls.push(["shuffle", enabled]), waitForShuffleOff: async () => calls.push("off confirmed"), start: async () => calls.push("start playlist at song"), waitForSelection: async () => calls.push("song confirmed")});
 assert.deepEqual(calls, [["shuffle", false], "off confirmed", "start playlist at song", "song confirmed", ["shuffle", true]]);
});
test("restores shuffle when playback fails", async () => {
 const calls = [];
 await assert.rejects(playSelectedWithShuffle({shuffle: true, setShuffle: async enabled => calls.push(enabled), waitForShuffleOff: async () => {}, start: async () => { throw new Error("failed"); }, waitForSelection: async () => {}}), /failed/);
 assert.deepEqual(calls, [false, true]);
});
test("does not change shuffle when it was off", async () => {
 const calls = [];
 await playSelectedWithShuffle({shuffle: false, setShuffle: async () => calls.push("shuffle"), waitForShuffleOff: async () => calls.push("wait"), start: async () => calls.push("start"), waitForSelection: async () => calls.push("wait")});
 assert.deepEqual(calls, ["start"]);
});
