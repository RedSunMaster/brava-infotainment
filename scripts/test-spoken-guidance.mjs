import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Loads a TypeScript module from src/lib, inlining its relative imports as data URLs.
async function load(name) {
	const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
	let compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
	for (const match of compiled.matchAll(/from "\.\/(\w+)"/g)) compiled = compiled.replace(match[0], `from "${await dataUrl(match[1])}"`);
	return compiled;
}
async function dataUrl(name) { return `data:text/javascript;base64,${Buffer.from(await load(name)).toString("base64")}`; }
const { toSpeech } = await import(await dataUrl("spokenText"));
const { announcementParts, lanePhrase } = await import(await dataUrl("spokenGuidance"));

test("street-type abbreviations are spelled out", () => {
	assert.equal(toSpeech("Turn left onto Papanui Rd."), "Turn left onto Pah-pah-noo-ee Road.");
	assert.equal(toSpeech("Turn right onto Memorial Ave."), "Turn right onto Memorial Avenue.");
	assert.equal(toSpeech("Turn left onto Millstream Dr."), "Turn left onto Millstream Drive.");
	assert.equal(toSpeech("Turn left onto Colombo St, then turn right."), "Turn left onto Colombo Street, then turn right.");
	assert.equal(toSpeech("Keep left onto Fendalton Rd and Waimairi Rd"), "Keep left onto Fendalton Road and Waimairi Road");
});

test("St, Dr and Mt are names when a capital follows and street types otherwise", () => {
	assert.equal(toSpeech("Turn left onto St Asaph St."), "Turn left onto Saint Asaph Street.");
	assert.equal(toSpeech("Turn right onto Dr Smith Ave."), "Turn right onto Doctor Smith Avenue.");
	assert.equal(toSpeech("Continue onto Mt Pleasant Rd."), "Continue onto Mount Pleasant Road.");
});

test("highways are said in full and compass letters expand", () => {
	assert.equal(toSpeech("Merge onto SH1."), "Merge onto State Highway 1.");
	assert.equal(toSpeech("Merge onto SH 73 toward Kaiapoi."), "Merge onto State Highway 73 toward Ky-uh-poy.");
	assert.equal(toSpeech("Take the ramp onto Northern Motorway (SH 1)."), "Take the ramp onto Northern Motorway.");
	assert.equal(toSpeech("Turn left onto Main South Rd N."), "Turn left onto Main South Road North.");
	assert.equal(toSpeech("Head north on State Highway 1"), "Head north on State Highway 1");
});

test("ordinals, units and ampersands are made speakable", () => {
	assert.equal(toSpeech("At the roundabout, take the 2nd exit onto Main Rd."), "At the roundabout, take the second exit onto Main Road.");
	assert.equal(toSpeech("Continue for 500 meters."), "Continue for 500 metres.");
	assert.equal(toSpeech("Continue for 2 kilometers."), "Continue for 2 kilometres.");
	assert.equal(toSpeech("Turn left onto Smith & Co Rd."), "Turn left onto Smith and Co Road.");
});

test("Maori place names are respelled, with or without macrons, in any case", () => {
	assert.equal(toSpeech("Head to Waimakariri"), "Head to Why-mah-kah-ree-ree");
	assert.equal(toSpeech("Turn onto Ōtākaro Ave"), "Turn onto Oh-tah-kah-roh Avenue");
	assert.equal(toSpeech("Turn onto OTAKARO Ave"), "Turn onto Oh-tah-kah-roh Avenue");
	assert.equal(toSpeech("Drive to Whangarei"), "Drive to Fong-uh-ray");
	assert.equal(toSpeech("Continue to Te Anau"), "Continue to Tay Ah-now");
	// A word that merely contains a listed name is left alone.
	assert.equal(toSpeech("Turn onto Papanuis Rd"), "Turn onto Papanuis Road");
});

const step = (over = {}) => ({ id: 1, instruction: "Turn left onto Papanui Rd.", type: "turn", modifier: "left", lengthM: 900, final: false, ...over });

test("a turn is announced with its distance, then the instruction", () => {
	assert.deepEqual(announcementParts([step()], 0, "advance", 400), ["In 400 metres,", "Turn left onto Pah-pah-noo-ee Road."]);
	assert.deepEqual(announcementParts([step()], 0, "near", 40), ["Turn left onto Pah-pah-noo-ee Road."]);
});

test("a close second turn is chained, a distant one is not", () => {
	const next = step({ id: 2, instruction: "Turn right onto Main Rd.", type: "turn", modifier: "right" });
	assert.deepEqual(announcementParts([step({ lengthM: 120 }), next], 0, "advance", 300), ["In 300 metres,", "Turn left onto Pah-pah-noo-ee Road.", "Then, turn right."]);
	assert.deepEqual(announcementParts([step({ lengthM: 800 }), next], 0, "advance", 300), ["In 300 metres,", "Turn left onto Pah-pah-noo-ee Road."]);
	const exit = step({ id: 3, instruction: "At the roundabout, take the 2nd exit onto Ward St.", type: "roundabout" });
	assert.equal(announcementParts([step({ lengthM: 100 }), exit], 0, "near", null).at(-1), "Then, at the roundabout, take the second exit.");
});

test("the destination is announced by side, in the future tense until you are there", () => {
	const arrive = step({ id: 9, instruction: "You have arrived at your destination, on the right.", type: "arrive", modifier: "right", final: true, lengthM: 0 });
	assert.deepEqual(announcementParts([arrive], 0, "advance", 200), ["In 200 metres,", "Your destination will be on the right."]);
	assert.deepEqual(announcementParts([arrive], 0, "near", 30), ["Your destination is on the right."]);
	const stop = { ...arrive, final: false, modifier: "left" };
	assert.deepEqual(announcementParts([stop], 0, "near", 30), ["Your stop is on the left."]);
	const before = step({ lengthM: 90 });
	assert.equal(announcementParts([before, arrive], 0, "near", 30).at(-1), "Then, your destination will be on the right.");
});

test("lane cues name the lanes that work, only when it is possible to move over", () => {
	const lanes = (...valid) => valid.map(ok => ({ indications: ["straight"], valid: ok }));
	assert.equal(lanePhrase(step({ lanes: lanes(true, false, false) })), "Use the left lane.");
	assert.equal(lanePhrase(step({ lanes: lanes(false, false, true, true) })), "Use the right two lanes.");
	assert.equal(lanePhrase(step({ lanes: lanes(false, true, false) })), "Use the middle lane.");
	assert.equal(lanePhrase(step({ lanes: lanes(true, false, true) })), null);
	assert.equal(lanePhrase(step({ lanes: lanes(true, true, true) })), null);
	assert.equal(lanePhrase(step({ lanes: lanes(true) })), null);
	const withLanes = step({ lanes: lanes(false, true) });
	assert.deepEqual(announcementParts([withLanes], 0, "advance", 500), ["In 500 metres,", "Use the right lane.", "Turn left onto Pah-pah-noo-ee Road."]);
	assert.deepEqual(announcementParts([withLanes], 0, "advance", 100), ["In 100 metres,", "Turn left onto Pah-pah-noo-ee Road."]);
	assert.deepEqual(announcementParts([withLanes], 0, "near", 50), ["Turn left onto Pah-pah-noo-ee Road."]);
});
