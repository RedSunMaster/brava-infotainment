import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/routeAlerts.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
const { buildRouteAlerts, formatAhead } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const meters = Array.from({ length: 101 }, (_, i) => i * 100); // 10 km route, 100 m per point

test("no alerts for a clear route, and tiny delays are ignored", () => {
	assert.deepEqual(buildRouteAlerts({ meters, position: 0 }), []);
	assert.deepEqual(buildRouteAlerts({ meters, position: 0, trafficDelaySeconds: 90 }), []);
});
test("closures come first with distance; passed incidents are dropped", () => {
	const alerts = buildRouteAlerts({
		meters, position: 10,
		closures: [{ start: 40, end: 45 }],
		incidents: [{ id: "old", description: "Passed", index: 5 }, { id: "a", description: "Roadworks on SH1, lane closed for resurfacing between Hornby and Templeton", index: 20 }, { id: "b", description: "Crash", index: 60 }],
		trafficDelaySeconds: 420,
	});
	assert.deepEqual(alerts.map(alert => alert.kind), ["closure", "incident", "delay"]);
	assert.equal(alerts[0].detail, "3.0 km ahead");
	assert.ok(alerts[1].title.length <= 44 && alerts[1].title.endsWith("…"));
	assert.equal(alerts[1].detail, "1.0 km ahead · +1 more");
	assert.equal(alerts[2].title, "Traffic +7 min");
	assert.equal(alerts[2].severity, "warning");
});
test("big delays are errors, and stale traffic is a quiet note", () => {
	const [delay, stale] = buildRouteAlerts({ meters, position: 0, trafficDelaySeconds: 700, stale: true });
	assert.equal(delay.severity, "error");
	assert.equal(stale.severity, "info");
});
test("distance wording", () => {
	assert.equal(formatAhead(40), "just ahead");
	assert.equal(formatAhead(430), "450 m ahead");
	assert.equal(formatAhead(12400), "12 km ahead");
});
