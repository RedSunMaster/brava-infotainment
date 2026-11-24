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
const drivesUrl = await compile("drives", { exploration: explorationUrl });
const challengesUrl = await compile("driveChallenges", { drives: drivesUrl });
const raceUrl = await compile("raceGhost", { exploration: explorationUrl, drives: drivesUrl });
const { TripRecorder, smoothScore, scoreBand, trimTrips, readTrips, driveStats, sameRoute, tripSeconds, STILL_END_S, GAP_END_S, TRACKS_KEPT } = await import(drivesUrl);
const { challengesFor, evaluate, computeStreaks, currentChallenges, doneIds, dayKey, weekKey, addDays } = await import(challengesUrl);
const { RaceGhost, RaceMatcher, deltaLabel, clock, routeRecords } = await import(raceUrl);

const ORIGIN = [172.60685, -43.45389];
const M_LNG = 1 / (111_320 * Math.cos((ORIGIN[1] * Math.PI) / 180));
/** A point this many metres east of the origin (and north). */
const at = (east, north = 0) => [ORIGIN[0] + east * M_LNG, ORIGIN[1] + north / 110_540];

/**
 * Drives east from `x0` through legs of { seconds, speed, bearing?, limit? }, one fix a second. Returns what finished and where the car ended.
 * Speed changes are instant, so a leg that drops from 20 to 10 m/s is a very hard stop.
 */
function drive(recorder, t0, x0, legs) {
	let t = t0, x = x0;
	const finished = [], events = [];
	for (const leg of legs) {
		for (let i = 0; i < leg.seconds; i++) {
			t += 1000;
			x += leg.speed;
			const result = recorder.fix(t, at(x), leg.speed, leg.bearing ?? 90, leg.limit ?? null);
			if (result.finished) finished.push(result.finished);
			if (result.event) events.push(result.event);
		}
	}
	return { t, x, finished, events };
}
/** Legs that change speed evenly, one second each, so a start or stop is gentle unless a test wants otherwise. */
const ramp = (from, to, seconds = 8) => Array.from({ length: seconds }, (_, i) => ({ seconds: 1, speed: from + ((to - from) * (i + 1)) / seconds }));
/** A finished trip from a steady drive with a gentle start and stop, ended by standing still. */
function steadyTrip({ t0 = 1_700_000_000_000, speed = 14, seconds = 220, x0 = 0, limit = null } = {}) {
	const recorder = new TripRecorder();
	const run = drive(recorder, t0, x0, [{ seconds: 3, speed: 0 }, ...ramp(0, speed).map(leg => ({ ...leg, limit })), { seconds, speed, limit }, ...ramp(speed, 0), { seconds: STILL_END_S + 10, speed: 0 }]);
	assert.equal(run.finished.length, 1);
	return run.finished[0];
}

test("a steady drive is one trip with its distance, time and a perfect score; the wait at the end is trimmed off", () => {
	const trip = steadyTrip();
	// 220 s at 14 m/s, plus a gentle start and stop of 8 s each (half the speed on average).
	assert.ok(Math.abs(trip.distanceM - (14 * 220 + 14 * 8)) < 60, `distance ${trip.distanceM}`);
	assert.ok(Math.abs(tripSeconds(trip) - 236) <= 3, `seconds ${tripSeconds(trip)}`);
	assert.equal(trip.score, 100);
	assert.equal(trip.hardBrakes + trip.hardAccels + trip.hardCorners, 0);
	assert.ok(trip.track.length / 3 > 100 && trip.track.length % 3 === 0);
	assert.deepEqual(trip.track.slice(0, 3).map((n, i) => i < 2 ? Math.round(n * 1e5) : n), [Math.round(trip.from[0] * 1e5), Math.round(trip.from[1] * 1e5), 0]);
});

test("a shuffle or a short stop-start is not a trip", () => {
	const recorder = new TripRecorder();
	const run = drive(recorder, 1_700_000_000_000, 0, [{ seconds: 10, speed: 5 }, { seconds: STILL_END_S + 10, speed: 0 }]);
	assert.equal(run.finished.length, 0);
	assert.equal(recorder.active, false);
});

test("a red light does not end the trip, a long stop does and starts the next one", () => {
	const recorder = new TripRecorder();
	const run = drive(recorder, 1_700_000_000_000, 0, [
		{ seconds: 60, speed: 12 }, { seconds: 90, speed: 0 }, { seconds: 60, speed: 12 }, { seconds: STILL_END_S + 5, speed: 0 },
		{ seconds: 60, speed: 12 }, { seconds: STILL_END_S + 5, speed: 0 },
	]);
	assert.equal(run.finished.length, 2);
	assert.ok(Math.abs(run.finished[0].distanceM - 120 * 12) < 40);
	assert.ok(Math.abs(run.finished[1].distanceM - 60 * 12) < 40);
});

test("a long silence from the receiver ends the trip where the fixes stopped", () => {
	const recorder = new TripRecorder();
	const run = drive(recorder, 1_700_000_000_000, 0, [{ seconds: 120, speed: 12 }]);
	const result = recorder.fix(run.t + (GAP_END_S + 30) * 1000, at(run.x + 5000), 12, 90);
	assert.ok(result.finished);
	assert.ok(Math.abs(result.finished.distanceM - 120 * 12) < 40, "the jump across the gap is not distance driven");
	assert.equal(recorder.active, true, "the fix after the gap starts the next trip");
});

test("one hard stop is one event, however many fixes it spans", () => {
	const recorder = new TripRecorder();
	const run = drive(recorder, 1_700_000_000_000, 0, [{ seconds: 60, speed: 20 }, { seconds: 1, speed: 15 }, { seconds: 1, speed: 10 }, { seconds: 1, speed: 6 }, ...ramp(6, 14), { seconds: 100, speed: 14 }, ...ramp(14, 0), { seconds: STILL_END_S + 5, speed: 0 }]);
	assert.equal(run.finished[0].hardBrakes, 1);
	assert.deepEqual(run.events.filter(e => e === "brake"), ["brake"]);
	assert.ok(run.finished[0].score < 100);
});

test("a gentle slowdown and a normal start are not events", () => {
	const recorder = new TripRecorder();
	const legs = [{ seconds: 40, speed: 10 }];
	for (let s = 10; s >= 0; s -= 1.5) legs.push({ seconds: 1, speed: s });
	for (let s = 0; s <= 14; s += 1.8) legs.push({ seconds: 1, speed: s });
	legs.push({ seconds: 80, speed: 14 }, ...ramp(14, 0), { seconds: STILL_END_S + 5, speed: 0 });
	const run = drive(recorder, 1_700_000_000_000, 0, legs);
	assert.equal(run.finished[0].hardBrakes + run.finished[0].hardAccels, 0);
});

test("hard acceleration and sharp cornering are caught", () => {
	const recorder = new TripRecorder();
	const run = drive(recorder, 1_700_000_000_000, 0, [
		...ramp(0, 8), { seconds: 30, speed: 8 }, { seconds: 1, speed: 13 }, { seconds: 40, speed: 13 },
		{ seconds: 1, speed: 13, bearing: 120 }, { seconds: 1, speed: 13, bearing: 150 }, { seconds: 80, speed: 13, bearing: 150 }, ...ramp(13, 0).map(leg => ({ ...leg, bearing: 150 })), { seconds: STILL_END_S + 5, speed: 0, bearing: 150 },
	]);
	assert.equal(run.finished[0].hardAccels, 1);
	assert.equal(run.finished[0].hardCorners, 1, "30 degrees in a second at 13 m/s");
});

test("time over the limit lowers the score, and a trip without a known limit is not marked down for it", () => {
	const limit = 13.9; // 50 km/h
	const kept = steadyTrip({ speed: 13, limit });
	const fast = steadyTrip({ speed: 17, limit });
	const unknown = steadyTrip({ speed: 17 });
	assert.equal(kept.speedingS, 0);
	assert.ok(fast.speedingS > 200 && fast.limitedS > 200);
	assert.ok(fast.score < kept.score && fast.score >= 70, `fast ${fast.score}`);
	assert.equal(unknown.score, 100);
});

test("scores: too short is unscored, events cost per kilometre, and the bands", () => {
	const base = { distanceM: 10_000, movingS: 900, hardBrakes: 0, hardAccels: 0, hardCorners: 0, speedingS: 0, limitedS: 0 };
	assert.equal(smoothScore({ ...base, distanceM: 500 }), null);
	assert.equal(smoothScore({ ...base, movingS: 30 }), null);
	assert.equal(smoothScore(base), 100);
	const oneBrakeLong = smoothScore({ ...base, hardBrakes: 1 });
	const oneBrakeShort = smoothScore({ ...base, distanceM: 2000, movingS: 200, hardBrakes: 1 });
	assert.ok(oneBrakeLong > oneBrakeShort, "the same brake costs more on a shorter trip");
	assert.ok(smoothScore({ ...base, hardBrakes: 100 }) >= 40, "events cost at most 60 points");
	assert.ok(smoothScore({ ...base, speedingS: 900, limitedS: 900 }) >= 75, "speeding costs at most 25");
	assert.deepEqual([95, 80, 60, 30].map(scoreBand), ["great", "good", "fair", "rough"]);
});

test("saved trips are read back, and damaged ones dropped", () => {
	const trip = steadyTrip();
	const read = readTrips({ version: 1, trips: [JSON.parse(JSON.stringify(trip)), { id: 5 }, null, { ...JSON.parse(JSON.stringify(trip)), id: "b", track: [1, 2] }] });
	assert.equal(read.length, 2);
	assert.equal(read[1].track, undefined, "a track of the wrong shape is dropped, the trip kept");
	assert.deepEqual(readTrips(null), []);
});

test("old trips lose their track, except the fastest of each route", () => {
	const slow = steadyTrip({ t0: 1_600_000_000_000, speed: 12, seconds: 260 });
	const fast = { ...steadyTrip({ t0: 1_600_100_000_000, speed: 13, seconds: 240 }), id: "fast" };
	const filler = Array.from({ length: TRACKS_KEPT + 20 }, (_, i) => ({ ...steadyTrip({ t0: 1_650_000_000_000 + i * 600_000, x0: 50_000 * (i + 1), speed: 14 }), id: `f${i}` }));
	const trimmed = trimTrips([slow, fast, ...filler]);
	assert.equal(trimmed.length, filler.length + 2);
	assert.equal(trimmed.find(t => t.id === slow.id).track, undefined, "a slower run of a route is trimmed");
	assert.ok(trimmed.find(t => t.id === "fast").track, "the fastest run of its route keeps its track");
	assert.equal(trimmed[2].track, undefined, "a route driven once, long ago, loses its track");
	assert.ok(trimmed[trimmed.length - 1].track, "the newest keeps its track");
});

test("totals and weekly figures", () => {
	const now = 1_700_000_000_000;
	const a = { ...steadyTrip({ t0: now - 10 * 86_400_000 }), score: 90 };
	const b = { ...steadyTrip({ t0: now - 2 * 86_400_000 }), score: 70 };
	const stats = driveStats([a, b], now);
	assert.equal(stats.trips, 2);
	assert.equal(stats.averageScore, 80);
	assert.equal(stats.bestScore, 90);
	assert.equal(stats.week.trips, 1);
	assert.equal(stats.week.averageScore, 70);
});

// ── Challenges and streaks ──
const local = (year, month, day, hour = 10) => new Date(year, month - 1, day, hour).getTime();
/** A trip on a given local moment, with a distance, score and events. */
const tripOn = (ms, { km = 5, score = 90, brakes = 0, speedingS = 0 } = {}) => ({
	id: `t${ms}`, start: ms - 600_000, end: ms, distanceM: km * 1000, movingS: 600, maxSpeed: 20, from: at(0), to: at(km * 1000), score,
	hardBrakes: brakes, hardAccels: 0, hardCorners: 0, speedingS, limitedS: 600,
});

test("days and weeks: keys are local dates, and a week starts on Monday", () => {
	assert.equal(dayKey(local(2026, 11, 24)), "2026-11-24");
	assert.equal(addDays("2026-11-30", 1), "2026-12-01");
	assert.equal(addDays("2026-03-01", -1), "2026-02-28");
	assert.equal(weekKey(local(2026, 11, 24)), "2026-11-23"); // a Tuesday
	assert.equal(weekKey(local(2026, 11, 22)), "2026-11-16"); // a Sunday belongs to the week before
});

test("the same date always gives the same challenges, and different dates differ", () => {
	const a = challengesFor("day", "2026-11-24"), b = challengesFor("day", "2026-11-24");
	assert.deepEqual(a, b);
	assert.equal(a.length, 2);
	assert.notEqual(a[0].kind, a[1].kind);
	const kinds = new Set(Array.from({ length: 30 }, (_, i) => challengesFor("day", addDays("2026-11-01", i)).map(c => c.kind).join()));
	assert.ok(kinds.size > 5);
	assert.equal(challengesFor("week", "2026-11-23").length, 1);
});

test("challenge progress counts only the trips of its day or week", () => {
	const distance = { id: "d", period: "day", key: "2026-11-24", kind: "distance", target: 10, minKm: 0, title: "" };
	const trips = [tripOn(local(2026, 11, 23, 22), { km: 8 }), tripOn(local(2026, 11, 24, 9), { km: 4 }), tripOn(local(2026, 11, 24, 17), { km: 7 })];
	const progress = evaluate(distance, trips);
	assert.equal(progress.value, 11);
	assert.ok(progress.done);
	assert.equal(evaluate({ ...distance, target: 20 }, trips).done, false);
	const week = { ...distance, period: "week", key: "2026-11-23", target: 18 };
	assert.equal(evaluate(week, trips).value, 19);
	assert.equal(evaluate({ ...week, kind: "days", target: 2 }, trips).value, 2);
});

test("smooth, calm, limit-keeping and average challenges", () => {
	const base = { id: "x", period: "day", key: "2026-11-24", minKm: 3, title: "" };
	const trips = [tripOn(local(2026, 11, 24, 8), { km: 6, score: 92 }), tripOn(local(2026, 11, 24, 12), { km: 2, score: 99 }), tripOn(local(2026, 11, 24, 18), { km: 9, score: 70, brakes: 2 })];
	assert.equal(evaluate({ ...base, kind: "smoothTrip", target: 90 }, trips).value, 92, "the 99 was on a trip too short to count");
	assert.equal(evaluate({ ...base, kind: "calmDrive", target: 5 }, trips).value, 6, "the 9 km trip had hard brakes");
	assert.equal(evaluate({ ...base, kind: "withinLimit", target: 5 }, trips).done, true);
	assert.equal(evaluate({ ...base, kind: "withinLimit", target: 5 }, [tripOn(local(2026, 11, 24, 8), { km: 6, speedingS: 100 })]).done, false);
	const average = { ...base, period: "week", key: "2026-11-23", kind: "avgScore", target: 80 };
	assert.equal(evaluate(average, trips).done, true);
	assert.equal(evaluate(average, trips.slice(0, 2)).done, false, "fewer than three trips is not an average");
});

test("the driving streak lives through today until the day ends, and breaks after a missed day", () => {
	const now = local(2026, 11, 24, 15);
	const trips = [tripOn(local(2026, 11, 20)), tripOn(local(2026, 11, 21)), tripOn(local(2026, 11, 22)), tripOn(local(2026, 11, 23))];
	let streaks = computeStreaks(trips, now);
	assert.equal(streaks.days, 4);
	assert.equal(streaks.drivenToday, false);
	streaks = computeStreaks([...trips, tripOn(local(2026, 11, 24, 8))], now);
	assert.equal(streaks.days, 5);
	assert.equal(streaks.drivenToday, true);
	streaks = computeStreaks(trips.slice(0, 3), now); // last drove the 22nd: a day missed
	assert.equal(streaks.days, 0);
	assert.equal(streaks.bestDays, 3);
	assert.equal(computeStreaks([tripOn(local(2026, 11, 24, 8), { km: 0.4 })], now).days, 0, "under a kilometre is not a driving day");
	assert.equal(computeStreaks([], now).days, 0);
});

test("the smooth streak counts trips in a row at 80 or better", () => {
	const trips = [95, 90, 40, 85, 88, 92].map((score, i) => tripOn(local(2026, 11, 10 + i), { score }));
	const streaks = computeStreaks(trips, local(2026, 11, 16));
	assert.equal(streaks.smooth, 3);
	assert.equal(streaks.bestSmooth, 3);
	assert.equal(computeStreaks([...trips, tripOn(local(2026, 11, 17), { score: 50 })], local(2026, 11, 17)).smooth, 0);
});

test("finished challenges are noticed once, and daily challenge days make a streak", () => {
	const now = local(2026, 11, 24, 20);
	const before = doneIds(currentChallenges(now, []));
	assert.equal(before.size, 0);
	const huge = [tripOn(now - 3_600_000, { km: 300, score: 97 })];
	const after = doneIds(currentChallenges(now, huge));
	assert.ok(after.size >= 1, "a 300 km drive finishes at least a distance challenge");
	const set = challengesFor("day", dayKey(now));
	const day = (d, trips) => trips.map(t => ({ ...t, end: local(2026, 11, d, 12), start: local(2026, 11, d, 11) }));
	// Nothing done on a day with no trips: the streak is zero.
	assert.equal(computeStreaks([], now).challenges, 0);
	assert.ok(set.length > 0 && day(1, huge)[0].end === local(2026, 11, 1, 12));
});

// ── Ghosts ──
/** A saved trip along the east road at a steady speed, made by really driving it through the recorder. */
const ghostTrip = (id, speed, t0 = 1_700_000_000_000, x0 = 0) => ({ ...steadyTrip({ t0, speed, seconds: Math.round(4200 / speed), x0 }), id });

test("two runs of the same road are the same route, and a different road is not", () => {
	const a = ghostTrip("a", 14), b = ghostTrip("b", 12);
	assert.ok(sameRoute(a, b));
	assert.ok(!sameRoute(a, ghostTrip("c", 14, 1_700_000_000_000, 5000)), "starts elsewhere");
	assert.ok(!sameRoute(a, { ...b, distanceM: b.distanceM * 2 }), "far longer");
});

test("a ghost is ahead or behind according to where it was at the same point of the road", () => {
	const ghost = new RaceGhost(ghostTrip("g", 14)); // 4200 m in about 300 s
	assert.ok(ghost.usable);
	assert.ok(Math.abs(ghost.duration - 316) <= 4, `duration ${ghost.duration}`); // 4200 m at 14 m/s, plus the gentle start and stop
	const half = ghost.compare(at(2100), 100);
	assert.ok(Math.abs(half.deltaS - (100 - ghost.timeAt(2100))) < 2 && half.deltaS < -50, `delta ${half.deltaS}`); // well ahead of the ghost
	const late = ghost.compare(at(3000), 260);
	assert.ok(Math.abs(late.deltaS - (260 - ghost.timeAt(3000))) < 2 && late.deltaS > 25, `delta ${late.deltaS}`); // the ghost was at 3000 m much earlier
	assert.equal(ghost.compare(at(3000, 800), 270), null, "800 m off its road is no longer racing it");
	const start = ghost.positionAt(0), middle = ghost.positionAt(150), end = ghost.positionAt(9999);
	const along = (ghost.positionAt(ghost.timeAt(2100))[0] - start[0]) / M_LNG;
	assert.ok(Math.abs(along - 2100) < 40, `the ghost is 2100 m along when the road says so (${along})`);
	assert.ok(middle[0] > start[0] && middle[0] < end[0], "and part way along at 150 s");
	assert.ok(Math.abs(end[0] - ghost.trip.to[0]) < 1e-6, "the ghost waits at the finish");
	assert.ok(ghost.finished(at(4150)) && !ghost.finished(at(2000)));
});

test("the matcher picks the fastest earlier run once the drive is clearly on its road", () => {
	const slow = ghostTrip("slow", 11, 1_600_000_000_000), fast = ghostTrip("fast", 15, 1_600_100_000_000), other = ghostTrip("other", 14, 1_600_200_000_000, 20_000);
	const matcher = new RaceMatcher([slow, fast, other], at(0));
	assert.equal(matcher.any, true);
	assert.equal(matcher.update(at(100), 100, null), null, "too early to say");
	const found = matcher.update(at(600), 600, null);
	assert.equal(found.trip.id, "fast");
});

test("the matcher gives up when the drive leaves every earlier road, and ignores trips that started elsewhere", () => {
	const matcher = new RaceMatcher([ghostTrip("a", 14)], at(0));
	assert.equal(matcher.update(at(300, 400), 500, null), null);
	assert.equal(matcher.any, false);
	assert.equal(new RaceMatcher([ghostTrip("a", 14)], at(0, 5000)).any, false);
	assert.equal(new RaceMatcher([{ ...ghostTrip("a", 14), track: undefined }], at(0)).any, false, "a trip without a track cannot be raced");
});

test("knowing the destination picks the right run sooner", () => {
	const there = ghostTrip("there", 14);
	const matcher = new RaceMatcher([there], at(0));
	assert.equal(matcher.update(at(200), 200, at(4200))?.trip.id, "there");
	assert.equal(new RaceMatcher([there], at(0)).update(at(200), 200, at(0, 9000)), null, "it ended somewhere else");
});

test("race labels and the records of routes driven more than once", () => {
	assert.equal(deltaLabel(-12.4), "12 s ahead");
	assert.equal(deltaLabel(75), "1:15 behind");
	assert.equal(deltaLabel(0.3), "Level");
	assert.equal(clock(65), "1:05");
	const a = ghostTrip("a", 14, 1_600_000_000_000), b = { ...ghostTrip("b", 15, 1_600_100_000_000), race: { ghostId: "a", deltaS: -20 } }, c = { ...ghostTrip("c", 13, 1_600_200_000_000), race: { ghostId: "b", deltaS: 25 } };
	const records = routeRecords([a, b, c, ghostTrip("lone", 14, 1_600_300_000_000, 30_000)]);
	assert.equal(records.length, 1);
	assert.equal(records[0].best.id, "b");
	assert.equal(records[0].runs, 3);
	assert.equal(records[0].wins, 1);
});
