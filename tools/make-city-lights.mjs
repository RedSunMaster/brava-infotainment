// Builds the city-lights layer for the globe's night side: public/textures/city-lights.webp.
//
//   node tools/make-city-lights.mjs path/to/earth-night.jpg
//
// The input is a global, equirectangular (2:1) picture of the Earth at night, such as NASA's "Earth at Night" (Black Marble) map.
// Cities are warm points of light on a dark background; the faint purple tint over the land is not light, so only warm, bright
// pixels are kept. The output is a square Web Mercator picture (the shape Mapbox draws on the globe): warm white, with the amount
// of light as its transparency, softened a little so the lights read from space.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const input = args.find((arg, i) => !arg.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!input) { console.error("Usage: node tools/make-city-lights.mjs earth-night.jpg [--out file.webp] [--size 2048]"); process.exit(1); }
const out = flag("out", "public/textures/city-lights.webp");
const SIZE = Number(flag("size", 2048));
const GAIN = Number(flag("gain", 5));
// Camera and compression noise in the dark parts of the map; below this a pixel is not a light.
const FLOOR = Number(flag("floor", 9));
const MAX_LAT = 85.0511287798;

const { data: rgb, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
if (Math.abs(W / H - 2) > 0.05) console.warn(`Warning: ${W}x${H} is not 2:1, so it is probably not a global equirectangular map.`);

// How much warm light each pixel holds: red and green high, blue not (that is the purple glow of the land, not a light).
const light = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
	const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
	const warm = Math.max(r, g) - 0.55 * b - FLOOR;
	light[i] = Math.max(0, Math.min(255, Math.round(warm * GAIN)));
}
// Keep points of light, not broad glows: take off most of what the neighbourhood averages (the dim wash over deserts and sea ice).
const wash = await sharp(light, { raw: { width: W, height: H, channels: 1 } }).blur(7).raw().toBuffer();
for (let i = 0; i < W * H; i++) light[i] = Math.max(0, Math.round(light[i] - 0.85 * wash[i]));
// A soft halo round every light, so a single bright pixel is still visible from far away.
const halo = await sharp(light, { raw: { width: W, height: H, channels: 1 } }).blur(1.6).raw().toBuffer();
const strength = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) strength[i] = Math.min(255, Math.max(light[i], Math.round(halo[i] * 2.2)));

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rgba = Buffer.alloc(SIZE * SIZE * 4);
const sample = (u, v) => {
	const x = Math.min(W - 1.001, Math.max(0, u * W - 0.5)), y = Math.min(H - 1.001, Math.max(0, v * H - 0.5));
	const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
	const a = strength[y0 * W + x0], b = strength[y0 * W + ((x0 + 1) % W)], c = strength[(y0 + 1) * W + x0], d = strength[(y0 + 1) * W + ((x0 + 1) % W)];
	return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
};
for (let row = 0; row < SIZE; row++) {
	const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (row + 0.5)) / SIZE))) * 180) / Math.PI;
	const v = (90 - lat) / 180;
	for (let col = 0; col < SIZE; col++) {
		// No cities near the poles: whatever the map holds there is noise in the ice, which the Mercator stretch would blow up.
		const s = (sample((col + 0.5) / SIZE, v) / 255) * (1 - smoothstep(60, 66, -lat)) * (1 - smoothstep(72, 77, lat));
		const alpha = Math.round(255 * Math.min(1, smoothstep(0.03, 0.75, s) * 1.15));
		const o = (row * SIZE + col) * 4;
		// Warm white, a little more orange in the dim lights, as sodium street lighting is.
		rgba[o] = 255; rgba[o + 1] = 226 - Math.round(30 * (1 - s)); rgba[o + 2] = 170 - Math.round(50 * (1 - s)); rgba[o + 3] = alpha;
	}
}
await mkdir(dirname(out), { recursive: true });
const result = await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } }).webp({ quality: 88, alphaQuality: 92, effort: 5 }).toFile(out);
console.log(`${out}: ${SIZE}x${SIZE}, ${(result.size / 1048576).toFixed(2)} MB (from ${input})`);
