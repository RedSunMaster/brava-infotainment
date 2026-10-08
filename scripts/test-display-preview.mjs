import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
	new URL("../src/displayPreview.ts", import.meta.url),
	"utf8",
);
const compiled = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const {
	DEFAULT_DISPLAY_PREVIEW: defaults,
	previewGeometry,
	validateDisplayPreview,
} = await import(
	`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("fitted previews retain the target layout at different desktop scaling factors", () => {
	for (const scaleFactor of [1, 1.5, 2]) {
		const geometry = previewGeometry(defaults, {
			width: 1600,
			height: 900,
			scaleFactor,
		});
		assert.ok(geometry.width <= 1520 && geometry.height <= 800);
		assert.equal(geometry.width / geometry.zoomFactor, 1080);
		assert.ok(Math.abs(geometry.height / geometry.zoomFactor - 1920) < 3);
	}
});

test("system scaling changes the logical layout without changing the monitor frame", () => {
	const desktop = { width: 1600, height: 900, scaleFactor: 1.5 };
	const baseline = previewGeometry(defaults, desktop);
	const scaled = previewGeometry({ ...defaults, uiScale: 1.5 }, desktop);
	assert.equal(scaled.width, baseline.width);
	assert.equal(scaled.width / scaled.zoomFactor, 720);
});

test("physical size follows target and desktop PPI", () => {
	const desktop = { width: 2000, height: 2000, scaleFactor: 1 };
	const monitor = {
		...defaults,
		width: 1000,
		height: 2000,
		ppi: 100,
		desktopPpi: 100,
		sizeMode: "physical",
	};
	assert.equal(previewGeometry(monitor, desktop).width, 1000);
	assert.equal(previewGeometry({ ...monitor, ppi: 200 }, desktop).width, 500);
	assert.equal(
		previewGeometry({ ...monitor, desktopPpi: 200 }, desktop).width,
		2000,
	);
});

test("Verbatim physical size on a 27-inch Full HD desktop compensates for OS scaling", () => {
	for (const scaleFactor of [1, 1.25, 1.5, 2]) {
		const geometry = previewGeometry(
			{ ...defaults, sizeMode: "physical" },
			{ width: 2000, height: 2000, scaleFactor },
		);
		assert.ok(Math.abs(geometry.width * scaleFactor - 624) <= 2);
		assert.ok(Math.abs(geometry.height * scaleFactor - 1110) <= 2);
		assert.equal(geometry.width / geometry.zoomFactor, 1080);
	}
});

test("native pixels compensate for desktop OS scaling and rotation fits both dimensions", () => {
	const desktop = { width: 1600, height: 900, scaleFactor: 1.5 };
	assert.equal(
		previewGeometry({ ...defaults, sizeMode: "pixels" }, desktop).width *
			desktop.scaleFactor,
		1080,
	);
	const landscape = previewGeometry(
		{ ...defaults, width: 1920, height: 1080 },
		desktop,
	);
	assert.ok(landscape.width <= 1520 && landscape.height <= 800);
	assert.equal(landscape.width / landscape.zoomFactor, 1920);
});

test("invalid resolutions, density and scale are rejected", () => {
	assert.equal(validateDisplayPreview(defaults), null);
	for (const invalid of [
		{ width: 0 },
		{ height: 1920.5 },
		{ ppi: NaN },
		{ ppi: 0 },
		{ uiScale: 0 },
		{ desktopPpi: Infinity },
		{ sizeMode: "bad" },
	]) {
		assert.ok(validateDisplayPreview({ ...defaults, ...invalid }));
	}
});
