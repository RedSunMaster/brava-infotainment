import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/spotifyShows.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
const { parseShows, parseAudiobooks, parseEpisodes, inProgress, describeProgress, playBody } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("saved shows and audiobooks are reduced to what the library needs", () => {
	const shows = parseShows({ items: [{ show: { id: "s1", uri: "spotify:show:s1", name: "Pod", publisher: "Acme", images: [{ url: "u" }] } }, { show: {} }, null] });
	assert.deepEqual(shows, [{ id: "s1", name: "Pod", publisher: "Acme", imageUrl: "u", uri: "spotify:show:s1", kind: "show" }]);
	const books = parseAudiobooks({ items: [{ id: "b1", uri: "spotify:show:b1", name: "Book", authors: [{ name: "A" }, { name: "B" }], images: [] }] });
	assert.equal(books[0].publisher, "A, B");
	assert.equal(books[0].kind, "audiobook");
	assert.deepEqual(parseShows(null), []);
});

test("resume points: unfinished episodes continue, finished ones start over", () => {
	const episodes = parseEpisodes({ items: [
		{ id: "a", uri: "spotify:episode:a", name: "Half", duration_ms: 3_600_000, resume_point: { fully_played: false, resume_position_ms: 1_800_000 } },
		{ id: "b", uri: "spotify:episode:b", name: "Done", duration_ms: 600_000, resume_point: { fully_played: true, resume_position_ms: 600_000 } },
		{ id: "c", uri: "spotify:episode:c", name: "New", duration_ms: 600_000 },
	] }, "Pod");
	assert.deepEqual(inProgress(episodes).map(e => e.id), ["a"]);
	assert.equal(episodes[1].resumeMs, 0);
	assert.deepEqual(playBody(episodes, 0), { uris: ["spotify:episode:a", "spotify:episode:b", "spotify:episode:c"], position_ms: 1_800_000 });
	assert.deepEqual(playBody(episodes, 1), { uris: ["spotify:episode:b", "spotify:episode:c"] });
});

test("progress wording", () => {
	const ep = { durationMs: 3_900_000, resumeMs: 0, fullyPlayed: false };
	assert.equal(describeProgress(ep), "1 h 5 min");
	assert.equal(describeProgress({ ...ep, resumeMs: 3_000_000 }), "15 min left");
	assert.equal(describeProgress({ ...ep, fullyPlayed: true }), "Played");
});
