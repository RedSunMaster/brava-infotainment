import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/profiles.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
const { readProfiles, switchProfile, createProfile, updateProfile, deleteProfile, MAX_PROFILES } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function memory(initial = {}) {
	const map = new Map(Object.entries(initial));
	return { get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, getItem: k => map.has(k) ? map.get(k) : null, setItem: (k, v) => void map.set(k, String(v)), removeItem: k => void map.delete(k), map };
}

test("first run makes one Driver profile that keeps the settings already on the device", () => {
	const store = memory({ "brava-climate-temp": "21", "spotify_access_token": "t" });
	const state = readProfiles(store);
	assert.equal(state.profiles.length, 1);
	assert.equal(state.profiles[0].name, "Driver");
	assert.equal(store.getItem("brava-climate-temp"), "21");
	assert.equal(readProfiles(store).activeId, state.activeId);
});

test("switching swaps every brava setting and leaves the Spotify sign-in alone", () => {
	const store = memory({ "brava-climate-temp": "21", "brava.theme": "dark", "spotify_access_token": "token" });
	const first = readProfiles(store).activeId;
	let state = createProfile(store, "Sam", "😎", "#16a34a");
	const sam = state.profiles[1].id;
	state = switchProfile(store, sam);
	assert.equal(state.activeId, sam);
	assert.equal(store.getItem("brava-climate-temp"), null); // Sam starts from defaults
	assert.equal(store.getItem("brava.theme"), null);
	assert.equal(store.getItem("spotify_access_token"), "token");
	store.setItem("brava-climate-temp", "17");
	store.setItem("brava-favourites", "[1]");
	switchProfile(store, first);
	assert.equal(store.getItem("brava-climate-temp"), "21");
	assert.equal(store.getItem("brava-favourites"), null);
	switchProfile(store, sam);
	assert.equal(store.getItem("brava-climate-temp"), "17");
	assert.equal(store.getItem("brava-favourites"), "[1]");
	assert.equal(store.getItem("brava.theme"), null);
});

test("the Spotify account and music player set-up are the same in every profile", () => {
	const store = memory({ "spotify_access_token": "t", "spotify_token_expiry": "9", "spotify_refresh_token": "r", "brava-spotify-volume": "40", "brava-inapp-player": "false", "brava-resume-music": "true", "brava-climate-temp": "21" });
	const first = readProfiles(store).activeId;
	const sam = createProfile(store, "Sam", "😎", "#000").profiles[1].id;
	switchProfile(store, sam);
	for (const [key, value] of [["spotify_access_token", "t"], ["spotify_token_expiry", "9"], ["spotify_refresh_token", "r"], ["brava-spotify-volume", "40"], ["brava-inapp-player", "false"], ["brava-resume-music", "true"]]) assert.equal(store.getItem(key), value, key);
	assert.equal(store.getItem("brava-climate-temp"), null);
	store.setItem("brava-spotify-volume", "70");
	switchProfile(store, first);
	assert.equal(store.getItem("brava-spotify-volume"), "70");
	assert.equal(store.getItem("brava-climate-temp"), "21");
});

test("edit, limits and delete rules", () => {
	const store = memory();
	const first = readProfiles(store).activeId;
	let state = createProfile(store, "  A   very long name that goes on  ", "🐶", "#dc2626");
	assert.ok(state.profiles[1].name.length <= 16);
	assert.deepEqual(createProfile(store, "   ", "🐶", "#fff").profiles.length, 2); // blank name refused
	const id = state.profiles[1].id;
	state = updateProfile(store, id, { name: "Pat", avatar: "🦊" });
	assert.equal(state.profiles[1].name, "Pat");
	assert.equal(updateProfile(store, id, { name: " " }).profiles[1].name, "Pat");
	assert.equal(deleteProfile(store, first).profiles.length, 2); // active one stays
	store.setItem("brava-profile-data:" + id, "{}");
	assert.equal(deleteProfile(store, id).profiles.length, 1);
	assert.equal(store.getItem("brava-profile-data:" + id), null);
	assert.equal(deleteProfile(store, first).profiles.length, 1); // never the last
	for (let i = 0; i < 12; i++) state = createProfile(store, `P${i}`, "🙂", "#000");
	assert.equal(state.profiles.length, MAX_PROFILES);
});

test("damaged saved data falls back to a fresh profile", () => {
	const store = memory({ "brava-profiles": "{nope" });
	assert.equal(readProfiles(store).profiles.length, 1);
});
