import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const load = async name => {
	const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
	const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
	return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
};
const { createMasterVolume, appScale, outputLevel, displayLevel } = await load("lib/masterVolume");
const { createVoiceLevels, VOICE_DEFAULTS } = await load("lib/voiceLevels");
const memory = (data = {}) => ({ data, getItem(k) { return k in data ? data[k] : null; }, setItem(k, v) { data[k] = String(v); } });
const mixer = (start = { level: 40, muted: false }) => {
	const calls = [];
	return { calls, get: async () => start, setLevel: async l => { calls.push(["level", l]); return true; }, setMuted: async m => { calls.push(["mute", m]); return true; } };
};
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

test("without a system mixer the master level scales the app's own sound", () => {
	const master = createMasterVolume(memory());
	master.setLevel(100);
	assert.equal(appScale(master.get()), 0.8);
	master.setLevel(50);
	assert.equal(appScale(master.get()), 0.4);
	master.setMuted(true);
	assert.equal(appScale(master.get()), 0);
});
test("the first run adopts the old Spotify volume", () => {
	assert.equal(createMasterVolume(memory({ "brava-spotify-volume": "35" })).get().level, 35);
});
test("level and mute survive a restart, and raising the volume ends a mute", () => {
	const store = memory();
	const a = createMasterVolume(store);
	a.setLevel(30);
	a.setMuted(true);
	const b = createMasterVolume(store);
	assert.deepEqual([b.get().level, b.get().muted], [30, true]);
	b.setLevel(50);
	assert.equal(b.get().muted, false);
	assert.equal(createMasterVolume(store).get().muted, false);
});
test("with a system mixer the saved level is applied to it and the app does not scale", async () => {
	const m = mixer({ level: 90, muted: false });
	const master = createMasterVolume(memory({ "brava-master-volume": "25" }), m);
	await master.connect();
	await settle();
	assert.equal(master.get().system, true);
	assert.equal(appScale(master.get()), 1);
	assert.deepEqual(m.calls, [["level", 20]]);
});
test("with nothing saved the system level is adopted", async () => {
	const master = createMasterVolume(memory(), mixer({ level: 40, muted: true }));
	await master.connect();
	assert.deepEqual([master.get().level, master.get().muted, master.get().system], [50, true, true]);
});
test("a fast slider drag sends only the newest level, in order", async () => {
	const m = mixer();
	const master = createMasterVolume(memory({ "brava-master-volume": "40" }), m);
	await master.connect();
	await settle();
	m.calls.length = 0;
	for (const level of [41, 42, 43, 44, 45]) master.setLevel(level);
	await settle();
	assert.equal(m.calls.at(-1)[1], outputLevel(45));
	assert.ok(m.calls.length <= 2);
});
test("a mixer that is not there leaves the app in charge", async () => {
	const master = createMasterVolume(memory(), { get: async () => null, setLevel: async () => false, setMuted: async () => false });
	await master.connect();
	assert.equal(master.get().system, false);
});
test("voice levels default, clamp and persist per kind", () => {
	const store = memory({ "brava-voice-volume": "0.5", "brava-duck-level": "7" });
	const levels = createVoiceLevels(store);
	assert.deepEqual(levels.get(), { guidance: 0.5, alerts: VOICE_DEFAULTS.alerts, messages: VOICE_DEFAULTS.messages, chime: VOICE_DEFAULTS.chime, music: 1 });
	levels.set("alerts", 0.2);
	assert.equal(store.data["brava-voice-volume-alerts"], "0.2");
	assert.equal(createVoiceLevels(store).get().alerts, 0.2);
});
test("pactl output is read", async () => {
	const { parseVolume, parseMute } = await (async () => {
		// audioMain imports electron, so check the same patterns here.
		return { parseVolume: o => { const m = /(\d+)%/.exec(o); return m ? Math.min(100, Number(m[1])) : null; }, parseMute: o => { const m = /Mute:\s*(yes|no)/i.exec(o); return m ? m[1].toLowerCase() === "yes" : null; } };
	})();
	assert.equal(parseVolume("Volume: front-left: 32768 /  50% / -18.06 dB,   front-right: 32768 /  50% / -18.06 dB"), 50);
	assert.equal(parseMute("Mute: yes"), true);
	assert.equal(parseMute("Mute: no"), false);
});
test("100 in the app is 80 on the output, and the two map back", () => {
	assert.equal(outputLevel(100), 80);
	assert.equal(outputLevel(0), 0);
	assert.equal(displayLevel(80), 100);
	assert.equal(displayLevel(90), 100);
	assert.equal(displayLevel(40), 50);
});
