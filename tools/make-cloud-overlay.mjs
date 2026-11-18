// Builds the cloud overlay the globe uses at start-up: public/textures/earth-clouds.webp.
//
//   node tools/make-cloud-overlay.mjs                  generated clouds (a stand-in with realistic bands and swirls)
//   node tools/make-cloud-overlay.mjs map.jpg          a real cloud map instead
//
// A real map must be global and "equirectangular" (twice as wide as it is tall, longitude 180W to 180E left to right), with
// white clouds on a black background; NASA's Blue Marble cloud maps are like this. Either way the output is reprojected
// to Web Mercator (the shape Mapbox draws on the globe), turned into white-with-transparency, and saved as WebP.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const input = args.find((arg, i) => !arg.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const out = flag("out", "public/textures/earth-clouds.webp");
const SIZE = Number(flag("size", 4096));
const SEED = Number(flag("seed", 7));
// How grey becomes cloud: below LOW is clear sky, above HIGH is solid cloud. Real satellite maps have a grey haze over
// land and ice, so they need a higher LOW than the generated clouds do.
// LOCAL removes broad haze: satellite maps read cold ground and ice as faint cloud, so a smooth bright wash covers the high latitudes.
// Each pixel has LOCAL times its neighbourhood's average taken off, which keeps the cloud structure and drops the wash.
const LOCAL = Number(flag("local", input ? 0.7 : 0));
const SIGMA = Number(flag("sigma", 45));
const LOW = Number(flag("low", 0.08));
const HIGH = Number(flag("high", input ? 0.5 : 0.85));
// Satellites do not see the poles, so those bands are mirrored copies; fade them so they do not read as a solid white cap.
const POLE_FADE = Number(flag("pole-fade", input ? 0.9 : 0));

// ── The source: grey levels on an equirectangular grid (255 = solid cloud) ────────────────────────────────────
let grey, W, H;
if (input) {
	const { data, info } = await sharp(input).greyscale().raw().toBuffer({ resolveWithObject: true });
	grey = data; W = info.width; H = info.height;
	if (Math.abs(W / H - 2) > 0.05) console.warn(`Warning: ${W}x${H} is not 2:1, so it is probably not a global equirectangular map.`);
	if (LOCAL > 0) {
		const mean = await sharp(grey, { raw: { width: W, height: H, channels: 1 } }).blur(SIGMA).raw().toBuffer();
		grey = Uint8Array.from(grey, (g, i) => Math.max(0, Math.min(255, Math.round(g - LOCAL * mean[i]))));
	}
} else {
	W = 4096; H = 2048; grey = new Uint8Array(W * H);
	// 3D gradient noise sampled on the sphere itself, so there is no seam at the dateline and no pinching at the poles.
	let state = SEED >>> 0;
	const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
	const perm = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
	const P = new Uint8Array(512); for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
	const fade = t => t * t * t * (t * (t * 6 - 15) + 10), lerp = (a, b, t) => a + (b - a) * t;
	const grad = (h, x, y, z) => { const u = (h & 15) < 8 ? x : y, v = (h & 15) < 4 ? y : (h & 15) === 12 || (h & 15) === 14 ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
	const noise = (x, y, z) => {
		const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255; x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
		const u = fade(x), v = fade(y), w = fade(z), A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
		return lerp(lerp(lerp(grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z), u), lerp(grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z), u), v),
			lerp(lerp(grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1), u), lerp(grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1), u), v), w);
	};
	const fbm = (x, y, z, octaves) => { let sum = 0, amp = 0.5, f = 1, norm = 0; for (let o = 0; o < octaves; o++) { sum += amp * noise(x * f, y * f, z * f); norm += amp; amp *= 0.5; f *= 2.03; } return sum / norm; };
	const gauss = (x, mu, sigma) => Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));
	const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
	for (let row = 0; row < H; row++) {
		const lat = 90 - ((row + 0.5) / H) * 180, latR = (lat * Math.PI) / 180;
		const abs = Math.abs(lat);
		// Where the real planet is cloudy: the tropical rain belt, the stormy mid-latitudes, with clear dry bands between.
		const band = 0.55 + 0.45 * gauss(lat, 6, 10) + 0.5 * gauss(abs, 55, 14) - 0.4 * gauss(abs, 25, 8) - 0.1 * smooth(72, 90, abs);
		for (let col = 0; col < W; col++) {
			const lon = ((col + 0.5) / W) * 2 * Math.PI - Math.PI;
			const x = Math.cos(latR) * Math.cos(lon), y = Math.sin(latR), z = Math.cos(latR) * Math.sin(lon);
			// Stretch the pattern east-west a little and bend it, so systems look like weather rather than blobs.
			const warp = fbm(x * 2.2 + 9, y * 2.2, z * 2.2, 4) * 1.1;
			// Large systems, then ever finer structure inside them; the east-west stretch makes bands and swirls.
			const large = fbm(x * 3.2 + warp, y * 4.4 + warp * 0.7, z * 3.2 - warp, 5);
			const fine = fbm(x * 12 + warp * 2, y * 17 + warp, z * 12 - warp * 2, 5);
			const v = 0.5 + 0.5 * (0.7 * large + 0.45 * fine);
			const threshold = 0.6 - 0.24 * Math.min(1, Math.max(0, band));
			// Thin high cloud everywhere, thick cloud where the system is strong.
			const body = smooth(threshold, threshold + 0.26, v);
			const haze = 0.2 * smooth(0.3, 0.6, 0.5 + 0.5 * fbm(x * 6 + 3, y * 9, z * 6, 4));
			grey[row * W + col] = Math.round(255 * Math.min(1, body + haze * (1 - body)));
		}
	}
}

// ── Reproject to Web Mercator and turn grey into white with transparency ─────────────────────────────────────
const MAX_LAT = 85.0511287798;
const rgba = Buffer.alloc(SIZE * SIZE * 4);
const sample = (u, v) => {
	const x = Math.min(W - 1.001, Math.max(0, u * W - 0.5)), y = Math.min(H - 1.001, Math.max(0, v * H - 0.5));
	const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
	const a = grey[y0 * W + x0], b = grey[y0 * W + ((x0 + 1) % W)], c = grey[(y0 + 1) * W + x0], d = grey[(y0 + 1) * W + ((x0 + 1) % W)];
	return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
};
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const GAMMA = Number(flag("gamma", 1));
for (let row = 0; row < SIZE; row++) {
	// Mercator y runs from +MAX_LAT at the top to -MAX_LAT at the bottom.
	const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (row + 0.5)) / SIZE))) * 180) / Math.PI;
	const v = (90 - lat) / 180;
	const poleKeep = 1 - POLE_FADE * smoothstep(58, 80, Math.abs(lat));
	for (let col = 0; col < SIZE; col++) {
		const g = sample((col + 0.5) / SIZE, v) / 255;
		const alpha = Math.round(255 * 0.96 * smoothstep(LOW, HIGH, g) ** GAMMA * poleKeep);
		const o = (row * SIZE + col) * 4;
		rgba[o] = 247; rgba[o + 1] = 250; rgba[o + 2] = 255; rgba[o + 3] = alpha;
	}
}
await mkdir(dirname(out), { recursive: true });
const info = await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } }).webp({ quality: 80, alphaQuality: 90, effort: 5 }).toFile(out);
console.log(`${out}: ${SIZE}x${SIZE}, ${(info.size / 1048576).toFixed(2)} MB (${input ? `from ${input}` : "generated"}; covers latitude ±${MAX_LAT.toFixed(2)}°)`);
