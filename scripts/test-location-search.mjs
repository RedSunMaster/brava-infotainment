import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(await readFile(new URL("../src/lib/locationSearch.ts", import.meta.url), "utf8"), {
	compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 },
}).outputText;
const { searchUrls, mapboxResults, photonResults, mergeResults, searchLocations, businessResults, resolveLocation } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const position = [172.6, -43.5];
const result = (name, kind = "supermarket", coords = position) => ({ id: name + kind + coords.join(","), name, address: "Christchurch", kind, coords, source: "photon" });

test("both providers restrict searches to New Zealand and bias the actual position", () => {
	const urls = searchUrls("  Riccarton  ", position, "test-token");
	assert.equal(new URL(urls.address).searchParams.get("country"), "nz");
	assert.equal(new URL(urls.address).searchParams.get("proximity"), "172.6,-43.5");
	assert.equal(new URL(urls.places).searchParams.get("countrycode"), "NZ");
	assert.equal(new URL(urls.address).searchParams.get("q"), "Riccarton");
});

test("routing uses the vehicle access point rather than the building centre", () => {
	const matches = mapboxResults({ features: [{ geometry: { coordinates: [172.5, -43.5] }, properties: { name: "2 Riccarton Road", coordinates: { routable_points: [{ name: "default", longitude: 172.51, latitude: -43.51 }] } } }] });
	assert.deepEqual(matches[0].coords, [172.51, -43.51]);
});

test("foreign results and invalid coordinates are rejected", () => {
	const data = code => ({ geometry: { coordinates: position }, properties: { name: "Test", countrycode: code } });
	assert.equal(photonResults({ features: [data("DE"), data("NZ")] }).length, 1);
	assert.equal(mapboxResults({ features: [{ geometry: { coordinates: [500, 90] }, properties: { name: "Invalid" } }] }).length, 0);
});

test("stores outrank their bus stops and unrelated street matches disappear", () => {
	const matches = mergeResults([result("North Avenue", "Street")], [result("Pak n Save Wainoni", "bus stop"), result("PAK'nSAVE")], "Pak n Save");
	assert.equal(matches[0].kind, "supermarket");
	assert.equal(matches.length, 2);
});

test("duplicate places merge but different branches remain available", () => {
	const matches = mergeResults([result("PAK'nSAVE")], [result("PAK'nSAVE", "supermarket", [172.60001, -43.5]), result("PAK'nSAVE", "supermarket", [172.7, -43.5])], "Pak n Save");
	assert.equal(matches.length, 2);
});

test("a minor spelling mistake does not discard a provider's useful match", () => {
	assert.equal(mergeResults([], [result("Christchurch Airport", "aerodrome")], "Chrischurch airport").length, 1);
});

test("complete provider failure reports a recoverable connection error", async () => {
	const original = globalThis.fetch;
	try {
		globalThis.fetch = async () => new Response("", { status: 503 });
		await assert.rejects(searchLocations("Christchurch", position, "test", new AbortController().signal), /Check your internet/);
	} finally { globalThis.fetch = original; }
});

test("one failed provider still returns useful results and explains the limitation", async () => {
	const original = globalThis.fetch;
	try {
		globalThis.fetch = async url => url.includes("mapbox") ? new Response("", { status: 503 }) : Response.json({ features: [{ geometry: { coordinates: position }, properties: { name: "Christchurch Airport", countrycode: "NZ" } }] });
		const response = await searchLocations("Christchurch Airport", position, "test", new AbortController().signal);
		assert.equal(response.results.length, 1);
		assert.match(response.warning, /Address search/);
	} finally { globalThis.fetch = original; }
});

test("cancellation discards completed responses instead of presenting stale results", async () => {
	const original = globalThis.fetch;
	try {
		const controller = new AbortController();
		globalThis.fetch = async () => { controller.abort(); return Response.json({ features: [] }); };
		await assert.rejects(searchLocations("Christchurch", position, "test", controller.signal), { name: "AbortError" });
	} finally { globalThis.fetch = original; }
});

test("alternate venue wording returns both Christchurch branches ahead of distant locations", async () => {
	const original = globalThis.fetch;
	try {
		globalThis.fetch = async raw => {
			const url = new URL(raw);
			if (url.pathname.includes("geocode")) return Response.json({ features: [] });
			assert.equal(url.searchParams.get("session_token"), "test-session");
			const central = { mapbox_id: "central", name: "Action Indoor Sports Stadiums", full_address: "7 Iversen Terrace, Christchurch", distance: 10373, poi_category: ["gym"] };
			if (url.searchParams.get("q") === "Action Indoor Sports") return Response.json({ suggestions: [central, { ...central, mapbox_id: "hamilton", full_address: "53 Duke St, Hamilton", distance: 667000 }] });
			assert.equal(url.searchParams.get("q"), "Action Sports");
			assert.ok(url.searchParams.has("bbox"));
			return Response.json({ suggestions: [central, { mapbox_id: "hornby", name: "Action Sports and Leisure Hornby", full_address: "81 Buchanans Rd, Christchurch", distance: 10466, poi_category: ["gym", "sports"] }, { mapbox_id: "water", name: "Action Water Sports", full_address: "Filly Place, Christchurch", distance: 9714, poi_category: ["shopping"] }] });
		};
		const response = await searchLocations("Action Indoor Sports", position, "test", new AbortController().signal, "test-session");
		assert.deepEqual(response.results.slice(0, 2).map(item => item.id), ["central", "hornby"]);
		assert.equal(response.results.filter(item => item.id === "central").length, 1);
		assert.equal(response.results.some(item => item.id === "water"), false);
	} finally { globalThis.fetch = original; }
});

test("only the selected business is retrieved using its suggestion session", async () => {
	const original = globalThis.fetch;
	try {
		const [item] = businessResults([{ mapbox_id: "hornby", name: "Hornby" }], "test-session");
		globalThis.fetch = async raw => {
			const url = new URL(raw);
			assert.equal(url.searchParams.get("session_token"), "test-session");
			assert.ok(url.pathname.endsWith("/hornby"));
			return Response.json({ features: [{ geometry: { coordinates: [172.5, -43.5] } }] });
		};
		assert.deepEqual(await resolveLocation(item, "test", new AbortController().signal), [172.5, -43.5]);
	} finally { globalThis.fetch = original; }
});
