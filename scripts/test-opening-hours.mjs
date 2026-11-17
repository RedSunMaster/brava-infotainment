import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/openingHours.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
const { parseOpeningHours, openStatus, weekRows, arrivalStatus } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
// 2024-01-01 is a Monday; Date(y, m, d, h, min) uses local time, matching openStatus.
const at = (day, hour, minute = 0) => new Date(2024, 0, day, hour, minute);
const cafe = parseOpeningHours("Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off");

test("reports open with the closing time", () => {
	assert.deepEqual(openStatus(cafe, at(1, 12)), { state: "open", label: "Open · Closes 5:00 pm", minutes: 300 });
});
test("warns when closing within the hour", () => {
	const status = openStatus(cafe, at(1, 16, 15));
	assert.equal(status.state, "closing-soon");
	assert.equal(status.label, "Closing soon · 5:00 pm (45 min)");
});
test("warns when opening within the hour", () => {
	assert.equal(openStatus(cafe, at(1, 8, 20)).state, "opening-soon");
	assert.equal(openStatus(cafe, at(1, 8, 20)).label, "Opening soon · 9:00 am (40 min)");
});
test("closed states name the next opening", () => {
	assert.equal(openStatus(cafe, at(1, 20)).label, "Closed · Opens tomorrow 9:00 am");
	assert.equal(openStatus(cafe, at(6, 15)).label, "Closed · Opens Monday 9:00 am"); // Sat after close, Sunday off
});
test("handles split shifts and later rules overriding earlier days", () => {
	const week = parseOpeningHours("Mo-Su 09:00-17:00; We 10:00-12:00,13:00-15:00");
	assert.equal(openStatus(week, at(3, 10, 30)).state, "open");
	assert.equal(openStatus(week, at(3, 15, 30)).state, "closed"); // later Wednesday rule replaces 9-5
	assert.equal(openStatus(week, at(3, 13, 30)).label, "Open · Closes 3:00 pm");
});
test("handles opening past midnight", () => {
	const bar = parseOpeningHours("Fr 20:00-02:00");
	assert.equal(openStatus(bar, at(5, 23)).label, "Open · Closes 2:00 am");
	assert.equal(openStatus(bar, at(6, 1)).label, "Closing soon · 2:00 am (1 h)");
});
test("recognises 24 hour places", () => {
	assert.equal(openStatus(parseOpeningHours("24/7"), at(2, 3)).state, "open-24h");
	assert.equal(openStatus(parseOpeningHours("Mo-Su 00:00-24:00"), at(2, 3)).state, "open-24h");
});
test("returns null for hours it cannot read confidently", () => {
	assert.equal(parseOpeningHours(""), null);
	assert.equal(parseOpeningHours("sunrise-sunset"), null);
	assert.equal(parseOpeningHours("Sep-Mar Mo 09:00-17:00"), null);
	assert.equal(openStatus(null, at(1, 12)), null);
});
test("builds a Monday-first week with today flagged", () => {
	const rows = weekRows(cafe, at(1, 12));
	assert.equal(rows[0].day, "Monday");
	assert.equal(rows[0].today, true);
	assert.equal(rows[0].text, "9:00 am – 5:00 pm");
	assert.equal(rows[6].text, "Closed");
});

test("checks the hours at the time you will arrive, not now", () => {
	// Monday 4:15 pm, shop closes 5:00 pm.
	assert.equal(arrivalStatus(cafe, at(1, 16, 15), 20 * 60).state, "closing-soon");
	assert.equal(arrivalStatus(cafe, at(1, 16, 15), 20 * 60).label, "Closes 25 min after you arrive at 4:35 pm");
	assert.equal(arrivalStatus(cafe, at(1, 16, 15), 46 * 60).label, "Closed when you arrive at 5:01 pm");
	assert.equal(arrivalStatus(cafe, at(1, 16, 15), 46 * 60).state, "closed");
	// Fine to arrive at midday and stay open: nothing to say.
	assert.equal(arrivalStatus(cafe, at(1, 11), 10 * 60), null);
	// Closed now, open by the time you get there.
	assert.equal(arrivalStatus(cafe, at(1, 8, 10), 30 * 60).label, "Closed when you arrive at 8:40 am");
	assert.equal(arrivalStatus(cafe, at(1, 8, 10), 60 * 60).state, "open");
	assert.equal(arrivalStatus(cafe, at(1, 8, 10), 60 * 60).label, "Open when you arrive at 9:10 am");
	assert.equal(arrivalStatus(null, at(1, 12), 600), null);
	assert.equal(arrivalStatus(cafe, at(1, 12), NaN), null);
});
