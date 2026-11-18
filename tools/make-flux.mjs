// Portrait motion pack; no imports from or changes to the installed splash.
import sharp from 'sharp';
import { mkdir, writeFile, readFile, copyFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../../../Design/Brava-Flux-Portrait/', import.meta.url));
const WORK = join(tmpdir(), 'brava-flux-frames');
const BG = '#050709', FPS = 24, N = 72;
const ffmpeg = process.env.FFMPEG_PATH;
assert(ffmpeg, 'Set FFMPEG_PATH to an FFmpeg executable.');
for (const dir of ['master','boot','boot-lite','boot-lite-clockwise','preview']) await mkdir(join(ROOT,dir),{recursive:true});
await mkdir(WORK,{recursive:true});
const art = await sharp(join(ROOT,'source/ribbons.png')).resize(1080,1920,{fit:'contain',background:'#00000000'}).ensureAlpha().png().toBuffer();
const uri = `data:image/png;base64,${art.toString('base64')}`;
const smooth = (a,b,t) => {const x=Math.min(1,Math.max(0,(t-a)/(b-a)));return x*x*(3-2*x);};

function scene(t=3, phase=0) {
  const progress=smooth(0,2.6,t), alpha=smooth(0,.9,t);
  const pulse=Math.sin(Math.PI*phase)**2;
  const scale=.82+.18*progress+.014*pulse;
  const rotation=-5*(1-progress), y=80*(1-progress)-9*pulse;
  // Motion belongs to the light sculpture: a gentle approach, uncurl and settle.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
    <g opacity="${alpha}" transform="translate(540 ${850+y}) rotate(${rotation}) scale(${scale}) translate(-540 -850)">
      <image href="${uri}" width="1080" height="1920"/>
    </g>
  </svg>`;
}
async function raster(svg,path,width=1080) {
  await sharp(Buffer.from(svg)).resize(width,Math.round(width*16/9)).png().toFile(path);
}
const heldSvg=scene();
await writeFile(join(ROOT,'master/flux.svg'),heldSvg);
await raster(heldSvg,join(ROOT,'master/flux-1080x1920.png'));
await raster(heldSvg,join(ROOT,'master/flux-2160x3840.png'),2160);
await sharp(join(ROOT,'master/flux-1080x1920.png')).flatten({background:BG}).png().toFile(join(ROOT,'preview/portrait.png'));
for(let i=0;i<N;i++) {
  const name=`frame-${String(i+1).padStart(4,'0')}.png`;
  await raster(scene(i/FPS),join(ROOT,'boot',name));
  await sharp(join(ROOT,'boot',name)).resize(540,960).png().toFile(join(ROOT,'boot-lite',name));
  await sharp(join(ROOT,'boot-lite',name)).rotate(90).png().toFile(join(ROOT,'boot-lite-clockwise',name));
  if(i%24===23)console.log(`Boot: ${i+1}/${N}`);
}
await copyFile(join(ROOT,'boot/frame-0072.png'),join(ROOT,'held-end.png'));
await copyFile(join(ROOT,'boot-lite/frame-0072.png'),join(ROOT,'held-end-lite.png'));
await copyFile(join(ROOT,'boot-lite-clockwise/frame-0072.png'),join(ROOT,'held-end-lite-clockwise.png'));
for(let i=0;i<96;i++) {
  await raster(scene(3,smooth(.5,3.5,i/FPS)),join(WORK,`frame-${String(i+1).padStart(4,'0')}.png`));
  if(i%24===23)console.log(`App: ${i+1}/96`);
}
function encode(args) {
  const r=spawnSync(ffmpeg,['-y','-hide_banner','-loglevel','error',...args],{encoding:'utf8'});
  if(r.error)throw r.error;
  assert.equal(r.status,0,r.stderr);
}
console.log('Encoding portrait videos');
encode(['-framerate','24','-i',join(WORK,'frame-%04d.png'),'-c:v','libvpx-vp9','-crf','20','-b:v','0','-pix_fmt','yuva420p','-auto-alt-ref','0','-row-mt','1','-cpu-used','4','-an',join(ROOT,'app-loop.webm')]);
for(const [dir,out] of [[WORK,'app-loop.mp4'],[join(ROOT,'boot'),'preview/boot.mp4']]) {
  encode(['-f','lavfi','-i',`color=c=${BG}:s=1080x1920:r=24`,'-framerate','24','-i',join(dir,'frame-%04d.png'),'-filter_complex','[0:v][1:v]overlay=shortest=1:format=auto,format=yuv420p[v]','-map','[v]','-c:v','libx264','-preset','medium','-crf','18','-movflags','+faststart','-an',join(ROOT,out)]);
}
const held=await readFile(join(ROOT,'held-end.png'));
for(const path of [join(ROOT,'master/flux-1080x1920.png'),join(WORK,'frame-0001.png'),join(WORK,'frame-0096.png')])assert(held.equals(await readFile(path)),path);
let compressedBytes=0;
for(const [dir,w,h] of [['boot',1080,1920],['boot-lite',540,960],['boot-lite-clockwise',960,540]]) {
  const files=(await readdir(join(ROOT,dir))).filter(f=>/^frame-\d{4}\.png$/.test(f));
  assert.equal(files.length,N);
  for(let i=1;i<=N;i++) {
    const file=join(ROOT,dir,`frame-${String(i).padStart(4,'0')}.png`);
    const m=await sharp(file).metadata();assert(m.width===w&&m.height===h&&m.hasAlpha,file);
    if(dir==='boot')compressedBytes+=(await stat(file)).size;
  }
}
await writeFile(join(ROOT,'manifest.json'),JSON.stringify({name:'Brava / Flux / Portrait',background:BG,screen:[1080,1920],fps:24,bootFrames:72,bootSeconds:3,bootNativeDecodedMiB:1080*1920*4*72/1048576,bootLiteDecodedMiB:540*960*4*72/1048576,bootNativePngBytes:compressedBytes,appSeconds:4,alpha:true,verified:['72 sequential RGBA frames in each of 3 resolutions/orientations','held end equals native master and app first/last PNG source frames'],artwork:'Built-in image_gen; original prompt in source/prompt.txt; affine animation, not a simulated 3D scene'},null,2));
console.log('Flux pack rendered and source continuity checked.');
