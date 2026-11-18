// Design assets only: does not replace the installed boot theme or app splash.
import sharp from "sharp";
import { mkdir, writeFile, readFile, copyFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { logoSvg, BACKGROUND } from "./make-brand.mjs";

const root = fileURLToPath(new URL("../../../Design/Brava-Ignition/", import.meta.url));
const W = 960, H = 540, FPS = 24, COUNT = 72;
const smooth = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
// Reuse the actual car's lettering, with a finer illuminated-metal stroke.
const lettering = logoSvg({ glow: false }).replace(/<svg[^>]*>|<\/svg>/g, "")
  .replace('stroke="#f3f7ff"', 'stroke="url(#metal)"').replace('stroke-width="12"', 'stroke-width="5"')
  .replace('stroke-width="5" opacity="0.7"', 'stroke-width="2.2" opacity="0.65"');

export function scene(t = 3, { lightOnly = false, artOnly = false, breathe = 0 } = {}) {
  const reveal = smooth(0.25, 1.9, t), light = smooth(0, 0.8, t);
  const pulse = Math.sin(Math.PI * smooth(0.4, 2.7, t));
  const strength = (0.66 + pulse * 0.34 + breathe * 0.12) * light;
  const sweep = -180 + 1320 * smooth(0.15, 2.5, t);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <defs>
    <linearGradient id="metal" gradientUnits="userSpaceOnUse" x1="0" y1="-54" x2="0" y2="100"><stop stop-color="#ffffff"/><stop offset=".5" stop-color="#e2f1ff"/><stop offset="1" stop-color="#88accb"/></linearGradient>
    <linearGradient id="edge" gradientUnits="userSpaceOnUse" x1="108" y1="0" x2="852" y2="0"><stop stop-color="#83c5f4" stop-opacity="0"/><stop offset=".35" stop-color="#83c5f4" stop-opacity=".35"/><stop offset=".5" stop-color="#d5efff"/><stop offset=".65" stop-color="#83c5f4" stop-opacity=".35"/><stop offset="1" stop-color="#83c5f4" stop-opacity="0"/></linearGradient>
    <radialGradient id="aura"><stop stop-color="#4199dd" stop-opacity=".24"/><stop offset=".5" stop-color="#3178b8" stop-opacity=".09"/><stop offset="1" stop-color="#1f528d" stop-opacity="0"/></radialGradient>
    <radialGradient id="spark"><stop stop-color="#f0faff"/><stop offset=".1" stop-color="#a7dbff" stop-opacity=".7"/><stop offset="1" stop-color="#59aef4" stop-opacity="0"/></radialGradient>
    <filter id="blur" x="-50%" y="-300%" width="200%" height="700%"><feGaussianBlur stdDeviation="6"/></filter>
    <clipPath id="reveal"><rect x="-20" y="-100" width="${440 * reveal}" height="240"/></clipPath>
  </defs>
  ${artOnly ? "" : `<g opacity="${strength}">
    <ellipse cx="480" cy="287" rx="412" ry="224" fill="url(#aura)"/>
    <path d="M108 325 Q480 45 852 325" fill="none" stroke="url(#edge)" stroke-width=".8" opacity=".42"/>
    <path d="M150 326 Q480 87 810 326" fill="none" stroke="url(#edge)" stroke-width=".5" opacity=".16"/>
    <path d="M155 363 Q480 416 805 363" fill="none" stroke="url(#edge)" stroke-width=".7" opacity=".25"/>
    <path d="M170 366 H790" stroke="url(#edge)" stroke-width="3" filter="url(#blur)" opacity=".7"/>
    <path d="M170 366 H790" stroke="url(#edge)" stroke-width=".8" opacity=".8"/>
    <ellipse cx="480" cy="366" rx="85" ry="12" fill="url(#spark)" opacity=".42"/>
  </g>`}
  ${lightOnly ? "" : `<g opacity="${reveal}" transform="translate(223.29 230) scale(1.29)" clip-path="url(#reveal)">${lettering}</g>`}
  ${artOnly || t >= 2.5 ? "" : `<ellipse cx="${sweep}" cy="366" rx="105" ry="17" fill="url(#spark)" opacity="${Math.sin(Math.PI * smooth(.15, 2.5, t))}"/>`}
  </svg>`;
}

async function png(svg, path, width = W, opaque = false) {
  let img = sharp(Buffer.from(svg)).resize(width, Math.round(width * H / W));
  if (opaque) img = img.flatten({ background: BACKGROUND });
  await img.png().toFile(`${root}/${path}`);
}

const ffmpeg = process.env.FFMPEG_PATH;
assert(ffmpeg, "Set FFMPEG_PATH to an FFmpeg binary with libvpx-vp9 and libx264.");
for (const dir of ["boot", "boot-clockwise", "app-frames", "master", "preview"]) await mkdir(`${root}/${dir}`, { recursive: true });
await writeFile(`${root}/master/brava-ignition.svg`, scene());
await png(scene(), "master/brava-ignition.png", 1920);
await png(scene(3, { artOnly: true }), "master/art.png", 1920);
await png(scene(3, { lightOnly: true }), "master/light.png", 1920);
for (let i = 0; i < COUNT; i++) {
  await png(scene(i / FPS), `boot/frame-${String(i + 1).padStart(4, "0")}.png`);
  await sharp(`${root}/boot/frame-${String(i + 1).padStart(4, "0")}.png`).rotate(90).toFile(`${root}/boot-clockwise/frame-${String(i + 1).padStart(4, "0")}.png`);
}
await copyFile(`${root}/boot/frame-0072.png`, `${root}/held-end.png`);
await copyFile(`${root}/boot-clockwise/frame-0072.png`, `${root}/held-end-clockwise.png`);
await png(scene(), "preview/held-end-on-background.png", 1920, true);
for (let i = 0; i < 96; i++) {
  // The first and last half second are identical to the desktop still; the middle breathes once.
  const phase = smooth(.5, 3.5, i / FPS);
  await png(scene(3, { breathe: Math.sin(Math.PI * phase) ** 2 }), `app-frames/frame-${String(i + 1).padStart(4, "0")}.png`);
}
function encode(args) {
  const result = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
}
encode(["-framerate", "24", "-i", `${root}/app-frames/frame-%04d.png`, "-c:v", "libvpx-vp9", "-lossless", "1", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-an", `${root}/app-loop.webm`]);
// Opaque compatibility version, on the exact boot background.
for (const [folder, output] of [["app-frames", "app-loop.mp4"], ["boot", "preview/boot.mp4"]]) {
  encode(["-f", "lavfi", "-i", `color=c=${BACKGROUND}:s=${W}x${H}:r=24`, "-framerate", "24", "-i", `${root}/${folder}/frame-%04d.png`, "-filter_complex", "[0:v][1:v]overlay=shortest=1:format=auto,format=yuv420p[out]", "-map", "[out]", "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", "-an", `${root}/${output}`]);
}

// Prove that the boot, desktop and app handoff images are byte-for-byte identical.
const held = await readFile(`${root}/held-end.png`);
assert(held.equals(await readFile(`${root}/boot/frame-0072.png`)));
assert(held.equals(await readFile(`${root}/app-frames/frame-0001.png`)));
assert(held.equals(await readFile(`${root}/app-frames/frame-0096.png`)));
assert.equal((await readdir(`${root}/boot`)).filter(f => /^frame-\d{4}\.png$/.test(f)).length, COUNT);
for (const folder of ["boot", "app-frames"]) {
  for (const file of await readdir(`${root}/${folder}`)) {
    const meta = await sharp(`${root}/${folder}/${file}`).metadata();
    assert(meta.width === W && meta.height === H && meta.hasAlpha, file);
  }
}
const master = await sharp(`${root}/master/brava-ignition.png`).metadata();
assert(master.width >= 1674 && master.height >= 744 && master.hasAlpha);
const files = await readdir(`${root}/boot`);
const bytes = (await Promise.all(files.map(f => stat(`${root}/boot/${f}`)))).reduce((sum, s) => sum + s.size, 0);
await writeFile(`${root}/manifest.json`, JSON.stringify({ name: "Brava / Ignition", background: BACKGROUND, fps: FPS, bootFrames: COUNT, bootSeconds: 3, frameSize: [W, H], masterSize: [1920, 1080], bootPngBytes: bytes, bootDecodedRGBABytes: W * H * 4 * COUNT, heldEnd: "held-end.png", appVideo: "app-loop.webm", appLoopSeconds: 4, verified: ["PNG alpha and dimensions", "72 sequential boot frames", "boot end = desktop still = app first/last source frame"] }, null, 2));
console.log(`Created and checked ${root}; boot PNGs ${(bytes / 1048576).toFixed(1)} MiB; predecoded RGBA ${(W * H * 4 * COUNT / 1048576).toFixed(1)} MiB.`);
