import mapboxgl from "mapbox-gl";
import { CELLS, REVEAL_RADIUS_M, cellX, cellY, type LngLat } from "./exploration";

/**
 * Explore mode's fog: a bank of fog with real height, drawn on its own canvas just above the map's, so it covers
 * everything the map draws (the Standard style keeps some road labels above any layer an app can add, so a layer inside
 * the map cannot hide them). Map markers and the car are above this canvas. A Mapbox custom layer is still added, only
 * to be called with the camera matrices every frame, which keeps the fog exactly in step with the map.
 *
 * Each frame:
 *  1. "Seen" map (only when it changes): a top-down texture of the ground around the view, every explored cell drawn
 *     as a soft round blob, overlapping its neighbours so explored ground is solid with a soft edge. Alongside it, a
 *     small texture of terrain heights for the same area.
 *  2. Route: the route line as a band as wide as its white outline, at full resolution, in screen space.
 *  3. Fog volume: for every pixel, a ray from the camera is marched through a slab of fog
 *     at least FOG_HEIGHT_M deep (taller when zoomed out, so it keeps its shape on screen) lying on the terrain. Over unexplored ground the fog fills the slab; over explored ground it is
 *     gone, so the edge of explored ground is a wall of fog. Drifting noise shapes it.
 *  4. Composite: the volume with the route cut out of it.
 * With the camera low, it can be inside the slab's height: over a clearing it looks out at the walls round it; over
 * unexplored ground it is in the fog.
 * Zoomed out to the globe, the whole Earth is simply wrapped in fog.
 *
 * Noise is pinned to the ground and made of octaves whose weights shift smoothly with zoom, so zooming in and out never
 * makes the fog slide or rush about.
 */
export const FOG_LAYER_ID = "brava-fog";

const CHUNK_BITS = 8;
const CHUNK_SIZE = 1 << CHUNK_BITS;
const CHUNKS = CELLS / CHUNK_SIZE;
/**
 * Each cell's blob reaches this far from its centre (in cells): far enough for the distance field (below) to cover the
 * fog's taper. The explored-ground bell itself is only about 1.4 cells wide.
 */
const BLOB_RADIUS = 8;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
/**
 * Mapbox's globe radius in its own ECEF units (EXTENT / 2π), a hair bigger so the fog's flat facets never leave a gap at the
 * rim. (Labels on the rim no longer need covering: they are switched off under the fog when zoomed out.)
 */
const GLOBE_RADIUS = (8192 / Math.PI / 2) * 1.004;
/** The route's white outline width (CSS px) by zoom, as drawn by useRoute. */
const ROUTE_WIDTH: [number, number][] = [[8, 9], [12, 15], [15, 22], [18, 34]];
/** How tall the fog bank stands. */
const FOG_HEIGHT_M = 150;
const MASK_SIZE = 2048;
/** Resolution of the fog volume relative to the screen. Full: half made the edges against the map look smudgy. Lower it if the car's GPU struggles. */
const VOLUME_SCALE = 1;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const HEIGHT_SIZE = 64;
/** The seen map covers this many screen-sizes either side of the view's centre; beyond it, everything is fog. */
const MASK_REACH = 5;
/** Octaves of fog noise: from one bigger than the screen down to small wisps. */
const OCTAVES = 5;

/** born: when each cell was explored (seconds on the fog's clock), so newly explored ground can fade in. */
interface Chunk { x: number; y: number; keys: number[]; born: number[]; dirty: boolean; buffer: WebGLBuffer | null; vao: WebGLVertexArrayObject | null; count: number }
/** How long newly explored ground takes to clear: the fog over it thins and draws back rather than vanishing at once. */
const CLEAR_SECONDS = 1.4;
/** The square of ground the seen map covers, in mercator units, and its local frame (1 unit ≈ 1 metre). */
interface Region {
	cx: number; cy: number; half: number; zoom: number; metres: number; groundLow: number; groundHigh: number;
	/** The size the view wants right now (half rounds it up to a power of two), and the blob size the seen map was last drawn with. */
	wanted: number; drawnHalf: number;
}

/**
 * How big (half-width, mercator units) each explored cell's blob is drawn: its true size, or when zoomed out never under a
 * few of the seen map's pixels, or it would slip between them. Follows the zoom smoothly (not the area's power-of-two
 * size), so the seen map changes smoothly as you zoom out instead of in steps.
 */
const blobHalf = (wanted: number) => Math.max(BLOB_RADIUS / CELLS, (9 * wanted) / MASK_SIZE);

const NOISE = `
float hash(vec2 cell, float period) {
	cell = mod(cell, period);
	return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}
// Value noise that repeats every 'period' lattice units.
float noise(vec2 p, float period) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i, period), hash(i + vec2(1, 0), period), f.x), mix(hash(i + vec2(0, 1), period), hash(i + vec2(1, 1), period), f.x), f.y);
}`;

const MASK_VS = `#version 300 es
in vec2 a_corner;
// Position (x, y) and when the cell was explored (z).
in vec3 a_cell;
uniform vec4 u_place;
uniform float u_half;
uniform float u_now;
uniform float u_clear;
out vec2 v_corner;
out float v_grow;
void main() {
	v_corner = a_corner;
	// Newly explored ground comes in gradually, so the fog over it thins away instead of vanishing.
	v_grow = smoothstep(a_cell.z, a_cell.z + u_clear, u_now);
	gl_Position = vec4((a_cell.xy + a_corner * u_half) * u_place.xy + u_place.zw, 0.0, 1.0);
}`;

const MASK_FS = `#version 300 es
precision highp float;
in vec2 v_corner;
in float v_grow;
uniform float u_gain;
/** How many times wider than its true size the blob is drawn: the distance field is kept in true distances. */
uniform float u_scale;
out vec4 o_color;
void main() {
	// Red: a smooth bell (1.4 cells wide; the quad reaches 8 cells). Blobs are added together rather than the strongest
	// taken, like metaballs: the sum is smooth, so the edge of explored ground is a smooth curve, wide enough a bell
	// that it no longer follows the grid of cells. Taking the strongest made the edge a chain of circle arcs with a
	// sharp notch wherever two met.
	// Its height makes ground explored all over add up to 0.9, so the fog's edge (at 0.45, half of that) falls exactly
	// on the boundary of the explored ground. u_gain keeps a blob's total the same when it has to be drawn wider.
	// Alpha: how near the nearest explored cell is, exp(-(distance / 4 cells)²). These are combined by taking the largest,
	// so it measures the distance to explored ground, which tapers the fog away from it.
	float c = length(v_corner);
	// While clearing, each blob also swells from a smaller start, so cleared ground spreads rather than fading in place.
	float swell = mix(0.45, 1.0, v_grow);
	float d = c * 8.0 / 1.4 / swell;
	float away = c * u_scale / swell;
	// Green: where ground is still clearing (fading out as it clears), so the fog there can break up into wisps.
	float bell = exp(-d * d);
	o_color = vec4(u_gain * 0.146 * bell * v_grow, bell * (1.0 - v_grow), 0.0, exp(-4.0 * away * away) * v_grow);
}`;

// The route, as capsules (segments with round ends), so joins and corners are smooth.
// Laid on the ground (positions relative to the view's centre, in mercator units), so perspective squashes the cut-out
// exactly as it squashes the route line itself. a_seg is in metres: along the segment, across it, and its length.
const ROUTE_VS = `#version 300 es
in vec3 a_pos;
in vec3 a_seg;
uniform mat4 u_matrix;
out vec3 v_seg;
void main() { v_seg = a_seg; gl_Position = u_matrix * vec4(a_pos, 1.0); }`;

const ROUTE_FS = `#version 300 es
precision highp float;
in vec3 v_seg;
uniform float u_edge;
out vec4 o_color;
void main() {
	// Distance from the segment (round ends), in metres; the edge is softened over about a pixel.
	float d = length(vec2(max(0.0, max(-v_seg.x, v_seg.x - v_seg.z)), v_seg.y));
	float aa = fwidth(d);
	o_color = vec4(1.0 - smoothstep(u_edge - aa, u_edge + aa, d));
}`;

const SCREEN_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_ndc;
void main() { v_ndc = a_pos; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const VOLUME_FS = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform mat4 u_inverse;
uniform sampler2D u_mask;
uniform sampler2D u_height;
uniform float u_half;
// The previous seen map and heights, fading out over half a second after they are rebuilt, so nothing jumps.
uniform sampler2D u_maskBefore;
uniform sampler2D u_heightBefore;
/** Where the previous square was: its centre relative to this one (metres) and its half-size (metres). */
uniform vec3 u_before;
/** 1 once the new seen map has fully faded in. */
uniform float u_blend;
uniform float u_low;
uniform float u_high;
uniform float u_fogHeight;
/** A short step towards the sun, in metres: comparing the fog there with the fog here shades its lit and shadowed sides. */
uniform vec2 u_sun;
uniform float u_reach;
uniform float u_time;
/** How far between the two biggest octaves the large-scale variation sits (shifts smoothly with zoom). */
uniform float u_macroMix;
/** Distance (metres) over which far-off fog fades into haze. */
uniform float u_hazeDistance;
/** The car now (local metres) and how far round it is cleared (metres; 0: no car to clear round). */
uniform vec3 u_aura;
/** One explored cell's width, in metres. */
uniform float u_cell;
/** The angle one pixel of the fog covers (radians), to judge how big noise features look at a distance. */
uniform float u_pixel;
/** Per octave: scale, offset (x, y), and its level, which sets which way it drifts. */
uniform vec4 u_octave[${OCTAVES}];
uniform float u_amp[${OCTAVES}];
/** Weights of octaves 1 to 3, for the cheaper noise inside the volume. */
uniform float u_ampBroad[3];
out vec4 o_color;
${NOISE}
// Octave k of the ground-pinned noise at local point p (metres): scale and offset come in from the zoom.
float octave(int k, vec2 p, vec2 shift) {
	// Keyed to the octave's level, not its slot, so an octave keeps drifting the same way when zooming shifts the slots.
	float level = u_octave[k].w;
	vec2 drift = vec2(cos(level * 2.1), sin(level * 2.1)) * u_time * 0.05;
	// Repeats exactly once round the world (or every 256 cells for the finest), matching the globe's fog.
	return noise(p * u_octave[k].x + u_octave[k].yz + drift + shift, min(exp2(level), 256.0));
}
// How much of octave k to keep at distance t (metres): far off, an octave whose features would be under a few pixels
// only flickers as grain, so it fades out (as textures switch to coarser versions in the distance).
float keep(int k, float t) {
	float feature = 1.0 / u_octave[k].x;
	return smoothstep(2.0, 6.0, feature / max(t * u_pixel, 1e-3));
}
float detail(vec2 p, vec2 shift, float t) {
	float sum = 0.0, weight = 0.0;
	for (int k = 0; k < ${OCTAVES}; k++) {
		float w = u_amp[k] * keep(k, t);
		sum += w * octave(k, p, shift);
		weight += w;
	}
	// Re-weighted, so the fog is as thick far off; it just has less fine detail.
	return weight > 1e-4 ? sum / weight : 0.5;
}
// The three octaves that matter most at this zoom, for inside the volume where it is sampled many times.
float broad(vec2 p, vec2 shift, float t) {
	float w1 = u_ampBroad[0] * keep(1, t), w2 = u_ampBroad[1] * keep(2, t), w3 = u_ampBroad[2] * keep(3, t);
	float weight = w1 + w2 + w3;
	if (weight < 1e-4) return 0.5;
	return (w1 * octave(1, p, shift) + w2 * octave(2, p, shift) + w3 * octave(3, p, shift)) / weight;
}
// Variation on a much larger scale (a few screens across): whole areas of the bank higher or lower, so it does not look
// like the same mounds repeated into the distance. Blended between the two biggest octaves so zooming never jumps it.
float macro(vec2 p) {
	// One offset for both: an octave keeps the same pattern when zooming moves it from one slot to the other.
	return mix(octave(0, p, vec2(31.0, -17.0)), octave(1, p, vec2(31.0, -17.0)), u_macroMix);
}
float seenIn(sampler2D mask, vec2 uv) {
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
	return min(1.0, texture(mask, uv).r);
}
// Where the previous square covers this point, how much of it still shows (0 outside it: nothing to blend from).
float beforeWeight(vec2 uv) {
	if (u_blend >= 1.0 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
	return 1.0 - u_blend;
}
// How explored the ground is at a local point (metres from the square's centre).
float seenAt(vec2 p) {
	float now = seenIn(u_mask, p / (2.0 * u_half) + 0.5);
	vec2 uv = (p - u_before.xy) / (2.0 * u_before.z) + 0.5;
	float w = beforeWeight(uv);
	return w > 0.0 ? mix(now, texture(u_maskBefore, uv).r, w) : now;
}
// How far (in cells, about 28 m) a local point is from explored ground, up to 8: read from the distance field.
float cellsAway(vec2 p) {
	vec2 here = p / (2.0 * u_half) + 0.5;
	float near = any(lessThan(here, vec2(0.0))) || any(greaterThan(here, vec2(1.0))) ? 0.0 : texture(u_mask, here).a;
	vec2 uv = (p - u_before.xy) / (2.0 * u_before.z) + 0.5;
	float w = beforeWeight(uv);
	if (w > 0.0) near = mix(near, texture(u_maskBefore, uv).a, w);
	return near <= 0.0184 ? 8.0 : 4.0 * sqrt(-log(near));
}
// How much of the ground at a point is still clearing (newly explored, its fog not yet gone).
float clearingAt(vec2 p) {
	vec2 uv = p / (2.0 * u_half) + 0.5;
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
	return min(1.0, texture(u_mask, uv).g);
}
// How much fog stands at a point (1 all of it, 0 none), and in 'away' how far it is from cleared ground (in cells).
// Cleared ground is explored ground, and the ground right round the car now: that clears smoothly as the car moves,
// every frame, rather than in steps as GPS fixes arrive. The fog's noise n frays every edge; where ground is still
// clearing it gets much more say, so the fog breaks up into wisps rather than fading as round blobs.
float fogAt(vec2 p, float n, out float away) {
	float seen = seenAt(p);
	away = cellsAway(p);
	if (u_aura.z > 0.0) {
		float d = length(p - u_aura.xy);
		seen = max(seen, 0.9 * (1.0 - smoothstep(0.55 * u_aura.z, 1.15 * u_aura.z, d + (n - 0.5) * 0.9 * u_aura.z)));
		away = min(away, max(0.0, d - u_aura.z) / u_cell + 0.6);
	}
	float k = 0.18 + 1.1 * clearingAt(p);
	return 1.0 - smoothstep(0.38, 0.52, seen + (n - 0.5) * k);
}
// The terrain's height at a local point.
float groundAt(vec2 p) {
	float now = texture(u_height, p / (2.0 * u_half) + 0.5).r;
	vec2 uv = (p - u_before.xy) / (2.0 * u_before.z) + 0.5;
	float w = beforeWeight(uv);
	return w > 0.0 ? mix(now, texture(u_heightBefore, uv).r, w) : now;
}
vec3 fogColour(float lift, float n) {
	// Darker at the bottom, catching more light towards the top of the bank.
	return mix(vec3(0.085, 0.092, 0.104), vec3(0.32, 0.33, 0.35), clamp(lift * 0.6 + (n - 0.45) * 1.1, 0.0, 1.0));
}
// A band of haze along the horizon: thick at it, gone a few degrees above. It also hides distant mountains that rise
// beyond the area the fog maps.
vec4 horizonHaze(float up) {
	float haze = 1.0 - smoothstep(0.035, 0.09, up);
	return vec4(vec3(0.27, 0.285, 0.31) * haze, haze);
}
void main() {
	vec4 near = u_inverse * vec4(v_ndc, -1.0, 1.0); near /= near.w;
	vec4 far = u_inverse * vec4(v_ndc, 1.0, 1.0); far /= far.w;
	vec3 ro = near.xyz;
	vec3 rd = normalize(far.xyz - near.xyz);
	float top = u_high + u_fogHeight;
	// Looking up at the sky from above the fog: nothing to draw but the haze along the horizon.
	if (rd.z >= -1e-5 && ro.z > top) { o_color = horizonHaze(rd.z); return; }
	float tIn = rd.z < 0.0 ? max(0.0, (top - ro.z) / rd.z) : 0.0;
	float tGround = rd.z < 0.0 ? (u_low - ro.z) / rd.z : 1e9;
	float tFar = min(tGround, tIn + u_reach);
	// Skip the empty air above the bank cheaply (ground heights only), so the costly samples are all spent inside it.
	// Starting from the highest ground anywhere nearby instead made the samples' spacing jump whenever a hill came into
	// that area, and the fog's look jumped with it.
	const int SKIP = 24;
	float coarse = (tFar - tIn) / float(SKIP);
	float tStart = tFar;
	bool entered = false;
	for (int i = 0; i <= SKIP; i++) {
		float t = tIn + float(i) * coarse;
		vec3 p = ro + rd * t;
		if (p.z - groundAt(p.xy) < u_fogHeight) { tStart = max(tIn, t - coarse); entered = true; break; }
	}
	if (!entered) {
		// Never within the bank's height of the ground: sky, or (heading down) fog too far off to follow. Treating a ray
		// up into the sky as fog painted the sky grey whenever high ground nearby put the slab's top above the camera.
		// Looking out level or a little up: a band of haze along the horizon (thick at it, gone a few degrees above), which
		// also hides distant mountains rising beyond the area the fog maps.
		o_color = rd.z > -0.02 ? horizonHaze(rd.z) : vec4(vec3(0.27, 0.285, 0.31), 1.0);
		return;
	}
	// From there, deep enough to pass right through the bank to the ground. (With the camera down inside the bank's
	// height, over a clearing or in the fog itself, tStart is the camera and rays run out level to the walls.)
	float tOut = min(tFar, tStart + 2.5 * u_fogHeight / max(-rd.z, 0.05));
	// A smooth, evenly spread offset per pixel (interleaved gradient noise): hides the steps between samples without the
	// salt-and-pepper speckle of a random one.
	float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
	const int STEPS = 32;
	float span = tOut - tStart;
	float transmit = 1.0;
	vec3 colour = vec3(0.0);
	float tHit = -1.0;
	float tPrev = tStart;
	// Sunlit or shadowed, decided where the ray first meets the bank's surface.
	float shade = -1.0;
	// Where the fog turns mostly solid along this ray, for the haze of distance.
	float depth = -1.0;
	for (int i = 0; i < STEPS; i++) {
		// Samples close together near the camera and further apart in the distance (spaced by the square), so a wall
		// round a clearing you are standing in lands exactly where it is.
		float u0 = (float(i) + jitter) / float(STEPS), u1 = (float(i) + 1.0 + jitter) / float(STEPS);
		float t = tStart + span * u0 * u0;
		float dt = span * (u1 * u1 - u0 * u0);
		vec3 p = ro + rd * t;
		float lift = p.z - groundAt(p.xy);
		if (lift < 0.0) { tHit = t; break; }
		tPrev = t;
		float rise = lift / u_fogHeight;
		vec2 swirl = vec2(rise * 0.7, -rise * 0.5);
		float n = broad(p.xy, swirl, t);
		float away;
		float here = fogAt(p.xy, n, away);
		// The bank is full height over unexplored ground and sinks to nothing over explored ground: a wall at the edge.
		// Its top billows: the tallest mounds are three times the height of the lowest dips.
		// The wall stands where the ground fog ends (fogAt()), so the two line up instead of smearing past each other.
		float big = macro(p.xy);
		// Near explored ground the bank slopes down to nothing (over about 140 m) and thins out, rather than standing
		// up as a wall.
		// Fog thickens away from cleared ground over about 80 m.
		float thin = smoothstep(0.4, 3.0, away + (n - 0.5) * 1.2);
		float slope = smoothstep(0.4, 5.0, away + (n - 0.5) * 1.6);
		float bank = u_fogHeight * mix(0.33, 1.0, smoothstep(0.15, 0.85, n)) * mix(0.4, 1.0, smoothstep(0.2, 0.8, big)) * here * slope;
		// Density per metre scales with the bank's height, so it is just as thick at every zoom. A thin skin at the bank's
		// surface keeps its top soft-edged but defined.
		float density = (4.5 / u_fogHeight) * smoothstep(0.0, 0.06 * u_fogHeight, bank - lift) * (0.35 + 1.4 * n * n) * mix(0.25, 1.0, thin);
		float a = 1.0 - exp(-density * dt);
		if (shade < 0.0 && a > 0.02) {
			// Fog rising towards the sun puts this side in shadow; fog falling away leaves it lit.
			float towards = broad(p.xy + u_sun, swirl, t);
			shade = clamp(1.0 + (n - towards) * 3.5, 0.45, 1.5);
		}
		colour += transmit * a * fogColour(rise, mix(n, big, 0.3)) * max(shade, 0.0);
		transmit *= 1.0 - a;
		if (depth < 0.0 && transmit < 0.5) depth = t;
		if (transmit < 0.01) break;
	}
	if (transmit >= 0.01) {
		vec3 end = ro + rd * tOut;
		bool reachedGround = tHit >= 0.0 || end.z - groundAt(end.xy) < 0.0 || tOut >= tGround;
		if (!reachedGround) {
			// The ray skims on beyond what is worth following: all fog.
			colour += transmit * fogColour(0.4, 0.5);
			transmit = 0.0;
			if (depth < 0.0) depth = tOut;
		} else {
			// Find where the ray meets the ground, then cover it if it is unexplored.
			float lo = tPrev, hi = tHit < 0.0 ? tOut : tHit;
			for (int j = 0; j < 5; j++) {
				float mid = 0.5 * (lo + hi);
				vec3 p = ro + rd * mid;
				if (p.z - groundAt(p.xy) < 0.0) hi = mid; else lo = mid;
			}
			vec3 p = ro + rd * hi;
			float n = detail(p.xy, vec2(0.0), hi);
			// Same edge as the walls (same noise), so the ground fog and the wall above it meet cleanly.
			float b = broad(p.xy, vec2(0.0), hi);
			float awayHere;
			float cover = fogAt(p.xy, b, awayHere);
			cover *= smoothstep(0.4, 3.0, awayHere + (b - 0.5) * 1.2);
			colour += transmit * cover * fogColour(0.0, n);
			transmit *= 1.0 - cover;
			if (depth < 0.0) depth = hi;
		}
	}
	// The haze of distance: far-off fog fades towards a soft, even grey, as real fog and cloud do. It gives depth and hides
	// the sameness of the far mounds.
	float alpha = 1.0 - transmit;
	if (depth > 0.0) colour = mix(colour, vec3(0.27, 0.285, 0.31) * alpha, 0.85 * (1.0 - exp(-depth / u_hazeDistance)));
	o_color = vec4(colour, alpha);
}`;

const COMPOSITE_FS = `#version 300 es
precision mediump float;
in vec2 v_ndc;
uniform sampler2D u_volume;
uniform sampler2D u_route;
/** How solid the thickest fog is: just short of 1, so the map shows faintly through it. */
uniform float u_solid;
out vec4 o_color;
void main() {
	vec2 uv = v_ndc * 0.5 + 0.5;
	// A light blur over the nearest pixels smooths away the sampling pattern in thin fog; the route cut stays sharp.
	vec2 px = 1.0 / vec2(textureSize(u_volume, 0));
	vec4 fog = texture(u_volume, uv) * 0.36
		+ (texture(u_volume, uv + vec2(px.x, 0.0)) + texture(u_volume, uv - vec2(px.x, 0.0))
		+ texture(u_volume, uv + vec2(0.0, px.y)) + texture(u_volume, uv - vec2(0.0, px.y))) * 0.12
		+ (texture(u_volume, uv + px) + texture(u_volume, uv - px)
		+ texture(u_volume, uv + vec2(px.x, -px.y)) + texture(u_volume, uv + vec2(-px.x, px.y))) * 0.04;
	o_color = fog * u_solid * (1.0 - texture(u_route, uv).r);
}`;

// The globe and the flat map blend into each other between zoom 5 and 6, so the globe mesh carries both positions.
const GLOBE_VS = `#version 300 es
in vec3 a_ecef;
in vec2 a_merc;
uniform mat4 u_matrix;
uniform mat4 u_globeToMerc;
uniform float u_transition;
/** Which copy of the flat world this is (-1, 0 or 1): past the date line the half-flat map shows the next copy. */
uniform float u_copy;
out vec2 v_noise;
out float v_pole;
void main() {
	v_noise = vec2(a_merc.x + u_copy, a_merc.y);
	// Towards the poles the map's noise squeezes into a swirl; fade it out from about 70° to 80° of latitude.
	v_pole = smoothstep(0.27, 0.39, abs(a_merc.y - 0.5));
	// Blend the two shapes in world space and project once (as Mapbox does), so the GPU clips anything behind the
	// camera properly. Dividing by w before blending flipped such triangles across the screen when the view was tilted.
	vec4 globe = u_globeToMerc * vec4(a_ecef, 1.0);
	globe /= globe.w;
	gl_Position = u_matrix * mix(globe, vec4(a_merc.x + u_copy, a_merc.y, 0.0, 1.0), u_transition);
}`;

const GLOBE_FS = `#version 300 es
precision highp float;
in vec2 v_noise;
in float v_pole;
uniform float u_time;
/** Fades the globe's fog out as the 3D bank takes over, just past zoom 6. */
uniform float u_alpha;
// The same ground-pinned octaves as the 3D bank (scale per world, level), so the two match where one hands over.
uniform vec4 u_octave[${OCTAVES}];
uniform float u_amp[${OCTAVES}];
out vec4 o_color;
${NOISE}
void main() {
	float n = 0.0;
	for (int k = 0; k < ${OCTAVES}; k++) {
		float level = u_octave[k].w;
		vec2 drift = vec2(cos(level * 2.1), sin(level * 2.1)) * u_time * 0.05;
		// Each octave repeats a whole number of times round the world, so there is no seam at the date line.
		n += u_amp[k] * noise(v_noise * u_octave[k].x + drift, min(exp2(level), 256.0));
	}
	n = mix(n, 0.5, v_pole);
	// Coloured like the top of the bank seen from above.
	vec3 colour = mix(vec3(0.085, 0.092, 0.104), vec3(0.32, 0.33, 0.35), clamp(0.45 + (n - 0.45) * 1.1, 0.0, 1.0));
	o_color = vec4(colour, 1.0) * u_alpha;
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
	const program = gl.createProgram()!;
	for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
		const shader = gl.createShader(type)!;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Fog shader: ${gl.getShaderInfoLog(shader)}`);
		gl.attachShader(program, shader);
	}
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Fog program: ${gl.getProgramInfoLog(program)}`);
	return program;
}

/** The camera matrix moved to `origin`, so geometry near it can use small, precise numbers. */
function translated(matrix: ArrayLike<number>, ox: number, oy: number): Float32Array {
	const out = Float32Array.from(matrix as ArrayLike<number>);
	for (let r = 0; r < 4; r++) out[12 + r] = matrix[r] * ox + matrix[4 + r] * oy + matrix[12 + r];
	return out;
}

/** a × b for column-major 4×4 matrices. */
function multiply(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
	const out = new Array<number>(16).fill(0);
	for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
	return out;
}

/** Inverse of a column-major 4×4 matrix, or null if it has none. */
function invert(m: ArrayLike<number>): number[] | null {
	const inv = new Array<number>(16);
	inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
	inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
	inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
	inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
	inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
	inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
	inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
	inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
	inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
	inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
	inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
	inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
	inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
	inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
	inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
	inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
	const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
	if (!det) return null;
	return inv.map(value => value / det);
}

const mercY = (lat: number) => { const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const latOf = (y: number) => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y));

function routeWidth(zoom: number): number {
	if (zoom <= ROUTE_WIDTH[0][0]) return ROUTE_WIDTH[0][1];
	for (let i = 1; i < ROUTE_WIDTH.length; i++) {
		const [z1, w1] = ROUTE_WIDTH[i];
		if (zoom <= z1) { const [z0, w0] = ROUTE_WIDTH[i - 1]; return w0 + ((w1 - w0) * (zoom - z0)) / (z1 - z0); }
	}
	return ROUTE_WIDTH[ROUTE_WIDTH.length - 1][1];
}

/**
 * Fog noise octaves pinned to the ground: octave i repeats every 2^-i of the world. Each is weighted by a smooth window
 * around the size that suits the screen right now (peaking at 0.8 levels finer than the zoom). The window is zero exactly
 * where an octave joins or leaves the set, and the weights always add up to the same total, so zooming fades octaves in
 * and out with no jumps at all. With a region, scales are per local metre and offsets place its centre; without one
 * (the globe), scales are per whole world.
 */
function octaveSet(zoom: number, region?: Region): { octaves: Float32Array; amps: Float32Array; broadAmps: Float32Array } {
	const first = Math.ceil(zoom - 1.7);
	const bump = (level: number, low: number, width: number) => Math.sin((Math.PI * (level - zoom - low)) / width) ** 2;
	const octaves = new Float32Array(OCTAVES * 4), amps = new Float32Array(OCTAVES), broadAmps = new Float32Array(3);
	for (let k = 0; k < OCTAVES; k++) {
		const level = first + k, frequency = 2 ** level, period = Math.min(frequency, 256);
		octaves[k * 4] = region ? frequency / region.metres : frequency;
		octaves[k * 4 + 1] = region ? (region.cx * frequency) % period : 0;
		octaves[k * 4 + 2] = region ? (region.cy * frequency) % period : 0;
		octaves[k * 4 + 3] = level;
		// Five samples of a sin² window five levels wide always add up to 2.5.
		amps[k] = bump(level, -1.7, OCTAVES) / (OCTAVES / 2);
		// Octaves 1 to 3: a narrower window, three levels wide, adding up to 1.5.
		if (k >= 1 && k <= 3) broadAmps[k - 1] = bump(level, -0.7, 3) / 1.5;
	}
	return { octaves, amps, broadAmps };
}

/**
 * How solid the fog is at its thickest, by zoom. Never quite solid: from the globe you can just make out the continents
 * (about a tenth shows through); close up you can just make out roads and buildings (about a twentieth) but not read
 * names. The map is so much brighter than the fog that even this much shows clearly.
 */
export function fogSolidity(zoom: number): number {
	const t = Math.min(1, Math.max(0, (zoom - 4) / 10));
	return 0.9 + 0.055 * t * t * (3 - 2 * t);
}

interface Target { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number }
/** One version of the seen map and the terrain heights, for one square of ground. */
interface Area { region: Region; mask: Target; height: WebGLTexture }
/** How long a rebuilt seen map takes to fade in. */
const BLEND_MS = 500;

export class FogLayer implements mapboxgl.CustomLayerInterface {
	readonly id = FOG_LAYER_ID;
	readonly type = "custom" as const;
	readonly renderingMode = "2d" as const;
	private map: mapboxgl.Map | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private gl: WebGL2RenderingContext | null = null;
	private chunks = new Map<number, Chunk>();
	private programs: Record<"mask" | "route" | "volume" | "composite" | "globe", WebGLProgram> | null = null;
	private corners: WebGLBuffer | null = null;
	private screen: WebGLVertexArrayObject | null = null;
	private routeBuffer: WebGLBuffer | null = null;
	private routeVao: WebGLVertexArrayObject | null = null;
	/** The seen map in use, the one fading out, and a spare to build the next one in. */
	private area: Area | null = null;
	private before: Area | null = null;
	private spare: Area | null = null;
	private blendStart = 0;
	private routeTarget: Target | null = null;
	private volumeTarget: Target | null = null;
	private globe: { vao: WebGLVertexArrayObject; count: number } | null = null;
	private maskDirty = true;
	/**
	 * Newly explored cells, still clearing. They are drawn every frame on a copy of the settled seen map (cheap: a few
	 * hundred cells) and join the settled map once they have cleared, so the whole map is not redrawn every frame.
	 */
	private fresh: { key: number; born: number }[] = [];
	private lastSettle = 0;
	private freshBuffer: WebGLBuffer | null = null;
	private freshVao: WebGLVertexArrayObject | null = null;
	private working: Target | null = null;
	/** The seen map the fog reads this frame: the settled one, or the copy with the clearing cells on it. */
	private display: WebGLTexture | null = null;
	private heightsDirty = true;
	private route: { coords: LngLat[]; merc: Float64Array; heights: boolean } | null = null;
	private routeDrawn = false;
	/** Where to read the route from each frame (the map's route line can change at any time). */
	routeSource: (() => LngLat[] | null) | null = null;
	/** Where the car is, and who to tell how much fog (0–1) covers it on screen, so it can show as an outline. */
	puckSource: (() => LngLat | null) | null = null;
	onPuckFog: ((amount: number) => void) | null = null;
	private puckRead: { buffer: WebGLBuffer; sync: WebGLSync | null } | null = null;
	private start = performance.now();
	private terrainTimer: number | undefined;
	private onTerrain = (event: mapboxgl.MapSourceDataEvent) => {
		if (event.sourceId !== "brava-terrain") return;
		window.clearTimeout(this.terrainTimer);
		// Heights in view may have sharpened: read them again.
		this.terrainTimer = window.setTimeout(() => { this.heightsDirty = true; if (this.route) this.route.heights = false; }, 800);
	};

	/** Replaces every explored cell (on load or reset). */
	setCells(keys: Iterable<number>): void {
		for (const chunk of this.chunks.values()) this.freeChunk(chunk);
		this.chunks.clear();
		this.fresh = [];
		// Ground explored before is clear from the start.
		this.addCells(keys, false);
	}

	/**
	 * Newly explored cells; `fadeIn` clears the fog over them gradually (false: at once, for ground explored earlier).
	 * With `from` (where the car is), clearing spreads outward from there as a wave, about 120 m a second, with a little
	 * raggedness, rather than every cell of a GPS fix starting at once.
	 */
	addCells(keys: Iterable<number>, fadeIn = true, from?: LngLat): void {
		if (fadeIn) {
			const now = this.clock();
			const [fx, fy] = from ? [(from[0] + 180) / 360, mercY(from[1])] : [0, 0];
			const metres = from ? EARTH_CIRCUMFERENCE_M * Math.cos((from[1] * Math.PI) / 180) : 0;
			for (const key of keys) {
				let delay = 0;
				if (from) {
					const dx = (cellX(key) + 0.5) / CELLS - fx, dy = (cellY(key) + 0.5) / CELLS - fy;
					// Spread from the car, at most 4 s for the far side of a big loop; plus up to 0.35 s of jitter per cell.
					delay = Math.min(4, (Math.hypot(dx, dy) * metres) / 120) + ((Math.sin(key * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.35;
				}
				this.fresh.push({ key, born: now + delay });
			}
		} else {
			this.settle(keys);
		}
		this.map?.triggerRepaint();
	}

	/** Cells that have finished clearing go into the settled seen map. */
	private settle(keys: Iterable<number>): void {
		for (const key of keys) {
			const x = cellX(key), y = cellY(key);
			const id = (x >> CHUNK_BITS) * CHUNKS + (y >> CHUNK_BITS);
			let chunk = this.chunks.get(id);
			if (!chunk) { chunk = { x: x >> CHUNK_BITS, y: y >> CHUNK_BITS, keys: [], born: [], dirty: true, buffer: null, vao: null, count: 0 }; this.chunks.set(id, chunk); }
			chunk.keys.push(key);
			chunk.born.push(-1e6);
			chunk.dirty = true;
		}
		this.maskDirty = true;
	}

	/** Moves cleared cells across, in batches (about once a second while driving), so the settled map is rarely redrawn. */
	private settleCleared(): void {
		const now = this.clock();
		if (!this.fresh.length || now - this.lastSettle < 1) return;
		this.lastSettle = now;
		const done = this.fresh.filter(cell => now - cell.born >= CLEAR_SECONDS);
		if (!done.length) return;
		this.fresh = this.fresh.filter(cell => now - cell.born < CLEAR_SECONDS);
		this.settle(done.map(cell => cell.key));
	}

	/** Seconds on the fog's own clock. */
	private clock(): number { return (performance.now() - this.start) / 1000; }

	/** The route to keep clear of fog, or null when there is none. */
	setRoute(coords: LngLat[] | null): void {
		if (!coords || coords.length < 2) { this.route = null; return; }
		if (this.route && this.route.coords === coords) return;
		const merc = new Float64Array(coords.length * 3);
		coords.forEach(([lng, lat], i) => { merc[i * 3] = (lng + 180) / 360; merc[i * 3 + 1] = mercY(lat); });
		this.route = { coords, merc, heights: false };
	}

	onAdd(map: mapboxgl.Map): void {
		this.map = map;
		const canvas = document.createElement("canvas");
		canvas.setAttribute("aria-hidden", "true");
		// Right after the map's own canvas: above the map, below the markers and the car.
		canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;";
		map.getCanvas().after(canvas);
		const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: true, stencil: false });
		if (!gl) { canvas.remove(); return; }
		this.canvas = canvas;
		this.gl = gl;
		this.programs = {
			mask: compile(gl, MASK_VS, MASK_FS),
			route: compile(gl, ROUTE_VS, ROUTE_FS),
			volume: compile(gl, SCREEN_VS, VOLUME_FS),
			composite: compile(gl, SCREEN_VS, COMPOSITE_FS),
			globe: compile(gl, GLOBE_VS, GLOBE_FS),
		};
		this.corners = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
		// One triangle covering the screen, for the full-screen passes.
		this.screen = gl.createVertexArray();
		gl.bindVertexArray(this.screen);
		const screenBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, screenBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		for (const program of [this.programs.volume, this.programs.composite]) {
			const location = gl.getAttribLocation(program, "a_pos");
			gl.enableVertexAttribArray(location);
			gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
		}
		this.routeBuffer = gl.createBuffer();
		this.routeVao = gl.createVertexArray();
		gl.bindVertexArray(this.routeVao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.routeBuffer);
		const routePos = gl.getAttribLocation(this.programs.route, "a_pos"), routeSeg = gl.getAttribLocation(this.programs.route, "a_seg");
		gl.enableVertexAttribArray(routePos);
		gl.vertexAttribPointer(routePos, 3, gl.FLOAT, false, 24, 0);
		gl.enableVertexAttribArray(routeSeg);
		gl.vertexAttribPointer(routeSeg, 3, gl.FLOAT, false, 24, 12);
		gl.bindVertexArray(null);
		this.area = this.before = this.spare = null;
		this.working = null;
		this.display = null;
		this.freshBuffer = gl.createBuffer();
		this.freshVao = gl.createVertexArray();
		gl.bindVertexArray(this.freshVao);
		const freshCorner = gl.getAttribLocation(this.programs.mask, "a_corner"), freshCell = gl.getAttribLocation(this.programs.mask, "a_cell");
		gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
		gl.enableVertexAttribArray(freshCorner);
		gl.vertexAttribPointer(freshCorner, 2, gl.FLOAT, false, 0, 0);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.freshBuffer);
		gl.enableVertexAttribArray(freshCell);
		gl.vertexAttribPointer(freshCell, 3, gl.FLOAT, false, 0, 0);
		gl.vertexAttribDivisor(freshCell, 1);
		gl.bindVertexArray(null);
		this.buildGlobe(gl);
		for (const chunk of this.chunks.values()) { chunk.buffer = null; chunk.vao = null; chunk.dirty = true; }
		this.maskDirty = true;
		this.heightsDirty = true;
		map.on("sourcedata", this.onTerrain);
	}

	onRemove(map: mapboxgl.Map): void {
		map.off("sourcedata", this.onTerrain);
		this.puckRead = null;
		this.onPuckFog?.(0);
		window.clearTimeout(this.terrainTimer);
		// Dropping the canvas frees everything made on its context.
		for (const chunk of this.chunks.values()) { chunk.buffer = null; chunk.vao = null; chunk.dirty = true; }
		this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
		this.canvas?.remove();
		this.canvas = null;
		this.gl = null;
		this.programs = null;
		this.area = this.before = this.spare = null;
		this.routeTarget = this.volumeTarget = null;
		this.working = null;
		this.display = null;
		this.globe = null;
		this.map = null;
	}

	render(_mapGl: WebGL2RenderingContext, matrix: number[], projection?: mapboxgl.ProjectionSpecification, toMerc?: number[], transition?: number): void {
		const map = this.map, gl = this.gl, canvas = this.canvas, programs = this.programs;
		if (!map || !gl || !canvas || !programs) return;
		const mapCanvas = map.getCanvas();
		if (canvas.width !== mapCanvas.width || canvas.height !== mapCanvas.height) { canvas.width = mapCanvas.width; canvas.height = mapCanvas.height; }
		const time = (performance.now() - this.start) / 1000;
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.CULL_FACE);
		// Explored cells are far below a pixel on the globe, so the globe is all fog; the bank only forms on the flat map.
		const onGlobe = !!projection && projection.name === "globe" && (transition ?? 0) < 0.999 && !!toMerc;
		if (onGlobe) {
			// Coming back from the globe, start afresh: the last seen map may be of somewhere else entirely.
			if (this.area) { this.recycle(gl, this.area); this.recycle(gl, this.before); this.area = this.before = null; }
			this.drawGlobe(gl, matrix, toMerc!, transition ?? 0, time, fogSolidity(map.getZoom()), null);
			// The car is under the globe's fog.
			this.onPuckFog?.(1);
		} else {
			const area = this.updateArea(gl, map);
			this.setRoute(this.routeSource?.() ?? null);
			this.drawRoute(gl, matrix, map.getZoom());
			this.drawVolume(gl, matrix, area, map.getZoom(), time);
			// Just past the globe, its fog fades out over the 3D bank rather than switching off at once.
			const fade = 1 - Math.min(1, Math.max(0, (map.getZoom() - 6) / 0.5));
			// Once the map is fully flat Mapbox no longer passes the globe's matrix; it is not needed then (the shape is all flat).
			if (fade > 0) this.drawGlobe(gl, matrix, toMerc ?? IDENTITY, 1, time, fogSolidity(map.getZoom()), fade * fade * (3 - 2 * fade));
		}
		gl.bindVertexArray(null);
		// Keep the fog drifting.
		map.triggerRepaint();
	}

	private target(gl: WebGL2RenderingContext, width: number, height: number, existing?: Target | null, precise = false): Target {
		if (existing && existing.width === width && existing.height === height) return existing;
		const texture = existing?.texture ?? gl.createTexture()!;
		const framebuffer = existing?.framebuffer ?? gl.createFramebuffer()!;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		// Half floats where they can be drawn into: many faint blobs add up correctly instead of rounding to nothing.
		if (precise && gl.getExtension("EXT_color_buffer_float")) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
		else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		this.linearClamp(gl);
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		return { texture, framebuffer, width, height };
	}

	private linearClamp(gl: WebGL2RenderingContext): void {
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	}

	/**
	 * Keeps the seen map (and the terrain heights) centred on the view. Its size snaps to powers of two and its centre to
	 * its own height grid, so rebuilding it while panning samples exactly the same ground as before. When it does change
	 * (a new size, or newly loaded terrain), the new one fades in over the old instead of replacing it at once.
	 */
	private updateArea(gl: WebGL2RenderingContext, map: mapboxgl.Map): Area {
		this.settleCleared();
		const zoom = map.getZoom();
		const center = map.getCenter();
		const cx = (center.lng + 180) / 360, cy = mercY(center.lat);
		// Half the screen's longer side, in mercator units, times the reach, rounded up to a power of two.
		const wanted = (Math.max(map.getCanvas().clientWidth, map.getCanvas().clientHeight) / (512 * 2 ** zoom)) * MASK_REACH;
		const half = 2 ** Math.ceil(Math.log2(wanted));
		const cell = (2 * half) / HEIGHT_SIZE;
		let area = this.area;
		const moved = !area || area.region.half !== half || Math.abs(cx - area.region.cx) > half * 0.3 || Math.abs(cy - area.region.cy) > half * 0.3;
		if (moved || this.heightsDirty) {
			const region: Region = moved || !area
				? { cx: Math.round(cx / cell) * cell, cy: Math.round(cy / cell) * cell, half, zoom, metres: EARTH_CIRCUMFERENCE_M * Math.cos((center.lat * Math.PI) / 180), groundLow: 0, groundHigh: 0, wanted, drawnHalf: 0 }
				: { ...area.region, wanted };
			const next = this.spare ?? { region, mask: this.target(gl, MASK_SIZE, MASK_SIZE, null, true), height: this.heightTexture(gl) };
			next.region = region;
			this.readHeights(gl, map, next);
			this.drawMask(gl, next);
			// The old one fades out (the first one has nothing to fade from).
			this.spare = null;
			this.recycle(gl, this.before);
			this.before = area;
			this.area = area = next;
			this.blendStart = performance.now();
		} else {
			// Zoomed out, the blobs are drawn bigger as the zoom changes: redraw when they would be 3% off.
			area!.region.wanted = wanted;
			const drawn = area!.region.drawnHalf;
			if (Math.abs(blobHalf(wanted) - drawn) > drawn * 0.03) this.maskDirty = true;
			// Newly explored ground just appears in the map in use (that is the discovery itself).
			if (this.maskDirty) this.drawMask(gl, area!);
		}
		if (this.before && performance.now() - this.blendStart >= BLEND_MS) { this.recycle(gl, this.before); this.before = null; }
		this.display = this.fresh.length ? this.drawFresh(gl, area!) : area!.mask.texture;
		return area!;
	}

	/** Keeps one finished seen map to build the next in; frees any more (each holds a 16 MB texture). */
	private recycle(gl: WebGL2RenderingContext, area: Area | null): void {
		if (!area || area === this.spare) return;
		if (!this.spare) { this.spare = area; return; }
		gl.deleteTexture(area.mask.texture);
		gl.deleteFramebuffer(area.mask.framebuffer);
		gl.deleteTexture(area.height);
	}

	private heightTexture(gl: WebGL2RenderingContext): WebGLTexture {
		const texture = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([0]));
		this.linearClamp(gl);
		return texture;
	}

	/** Terrain heights over the area's square, in metres. */
	private readHeights(gl: WebGL2RenderingContext, map: mapboxgl.Map, area: Area): void {
		const region = area.region;
		const data = new Float32Array(HEIGHT_SIZE * HEIGHT_SIZE);
		const terrain = !!map.getTerrain();
		let low = Infinity, high = -Infinity;
		for (let j = 0; j < HEIGHT_SIZE; j++) {
			for (let i = 0; i < HEIGHT_SIZE; i++) {
				const x = region.cx - region.half + (2 * region.half * (i + 0.5)) / HEIGHT_SIZE;
				const y = region.cy - region.half + (2 * region.half * (j + 0.5)) / HEIGHT_SIZE;
				const height = terrain ? map.queryTerrainElevation([x * 360 - 180, latOf(y)]) ?? 0 : 0;
				data[j * HEIGHT_SIZE + i] = height;
				low = Math.min(low, height);
				high = Math.max(high, height);
			}
		}
		region.groundLow = low - 5;
		region.groundHigh = high;
		gl.bindTexture(gl.TEXTURE_2D, area.height);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, HEIGHT_SIZE, HEIGHT_SIZE, 0, gl.RED, gl.FLOAT, data);
		this.linearClamp(gl);
		this.heightsDirty = false;
	}

	/** Every explored cell in the square, top-down. */
	private drawMask(gl: WebGL2RenderingContext, area: Area): void {
		const { mask, region } = area, program = this.programs!.mask;
		gl.bindFramebuffer(gl.FRAMEBUFFER, mask.framebuffer);
		gl.viewport(0, 0, mask.width, mask.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		this.maskSetup(gl, region, true);
		const place = gl.getUniformLocation(program, "u_place");
		const size = CHUNK_SIZE / CELLS;
		for (const chunk of this.chunks.values()) {
			const x = chunk.x * size, y = chunk.y * size;
			if (x + size < region.cx - region.half || x > region.cx + region.half || y + size < region.cy - region.half || y > region.cy + region.half) continue;
			if (chunk.dirty || !chunk.vao) this.upload(gl, chunk);
			if (!chunk.vao || !chunk.count) continue;
			gl.uniform4f(place, 1 / region.half, 1 / region.half, (x - region.cx) / region.half, (y - region.cy) / region.half);
			gl.bindVertexArray(chunk.vao);
			gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, chunk.count);
		}
		gl.bindVertexArray(null);
		gl.blendEquation(gl.FUNC_ADD);
		this.maskDirty = false;
	}

	/**
	 * The settled seen map with the cells still clearing drawn on top, on a copy made fresh each frame. Returns the copy.
	 */
	private drawFresh(gl: WebGL2RenderingContext, area: Area): WebGLTexture {
		const { mask, region } = area;
		this.working = this.target(gl, mask.width, mask.height, this.working, true);
		const working = this.working;
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, mask.framebuffer);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, working.framebuffer);
		gl.blitFramebuffer(0, 0, mask.width, mask.height, 0, 0, working.width, working.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, working.framebuffer);
		gl.viewport(0, 0, working.width, working.height);
		this.maskSetup(gl, region, false);
		const data = new Float32Array(this.fresh.length * 3);
		this.fresh.forEach((cell, i) => {
			data[i * 3] = (cellX(cell.key) + 0.5) / CELLS - region.cx;
			data[i * 3 + 1] = (cellY(cell.key) + 0.5) / CELLS - region.cy;
			data[i * 3 + 2] = cell.born;
		});
		gl.bindBuffer(gl.ARRAY_BUFFER, this.freshBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
		gl.uniform4f(gl.getUniformLocation(this.programs!.mask, "u_place"), 1 / region.half, 1 / region.half, 0, 0);
		gl.bindVertexArray(this.freshVao);
		gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.fresh.length);
		gl.bindVertexArray(null);
		gl.blendEquation(gl.FUNC_ADD);
		this.map?.triggerRepaint();
		return working.texture;
	}

	/** Blending and uniforms shared by drawing the settled seen map and the cells still clearing. */
	private maskSetup(gl: WebGL2RenderingContext, region: Region, settled: boolean): void {
		const program = this.programs!.mask;
		gl.enable(gl.BLEND);
		// Colour added up (the explored-ground field); alpha the largest (the distance field).
		gl.blendEquationSeparate(gl.FUNC_ADD, gl.MAX);
		gl.blendFunc(gl.ONE, gl.ONE);
		gl.useProgram(program);
		// Never narrower than a few of the mask's pixels, or it would slip between them. A blob drawn
		// wider than its true size is drawn fainter by the same area, so explored ground keeps its true size at every zoom.
		const trueHalf = BLOB_RADIUS / CELLS, drawnHalf = settled ? blobHalf(region.wanted) : region.drawnHalf;
		region.drawnHalf = drawnHalf;
		gl.uniform1f(gl.getUniformLocation(program, "u_scale"), drawnHalf / trueHalf);
		gl.uniform1f(gl.getUniformLocation(program, "u_now"), this.clock());
		gl.uniform1f(gl.getUniformLocation(program, "u_clear"), CLEAR_SECONDS);
		gl.uniform1f(gl.getUniformLocation(program, "u_half"), drawnHalf);
		gl.uniform1f(gl.getUniformLocation(program, "u_gain"), (trueHalf / drawnHalf) ** 2);
	}

	/** The route as smooth capsules as wide as its outline, in screen space at full resolution. */
	private drawRoute(gl: WebGL2RenderingContext, matrix: number[], zoom: number): void {
		const canvas = this.canvas!, map = this.map!, route = this.route;
		this.routeTarget = this.target(gl, canvas.width, canvas.height, this.routeTarget);
		const target = this.routeTarget;
		gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
		gl.viewport(0, 0, target.width, target.height);
		if (!route || zoom < 5) {
			if (this.routeDrawn) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); this.routeDrawn = false; }
			return;
		}
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		const { merc, coords } = route;
		if (!route.heights && map.getTerrain()) {
			for (let i = 0; i < coords.length; i++) { const h = map.queryTerrainElevation(coords[i]); merc[i * 3 + 2] = h == null ? 0 : h / (EARTH_CIRCUMFERENCE_M * Math.cos((coords[i][1] * Math.PI) / 180)); }
			route.heights = true;
		}
		// Half the white outline's width, turned from screen pixels (at the view's centre) into metres on the ground.
		const center = map.getCenter();
		const cx = (center.lng + 180) / 360, cy = mercY(center.lat);
		const metresPerMerc = EARTH_CIRCUMFERENCE_M * Math.cos((center.lat * Math.PI) / 180);
		const metresPerPixel = metresPerMerc / (512 * 2 ** zoom);
		const edge = (routeWidth(zoom) / 2) * metresPerPixel;
		const half = edge * 1.3;
		// Only segments near the view (generously, for steep tilts).
		const bounds = map.getBounds();
		const pad = 0.5;
		let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
		if (bounds) {
			const x0 = (bounds.getWest() + 180) / 360, x1 = (bounds.getEast() + 180) / 360, y0 = mercY(bounds.getNorth()), y1 = mercY(bounds.getSouth());
			minX = x0 - (x1 - x0) * pad; maxX = x1 + (x1 - x0) * pad; minY = y0 - (y1 - y0) * pad; maxY = y1 + (y1 - y0) * pad;
		}
		const out: number[] = [];
		const vertex = (x: number, y: number, z: number, along: number, across: number, length: number) => out.push(x - cx, y - cy, z, along, across, length);
		for (let i = 1; i < coords.length; i++) {
			const ax = merc[i * 3 - 3], ay = merc[i * 3 - 2], az = merc[i * 3 - 1];
			const bx = merc[i * 3], by = merc[i * 3 + 1], bz = merc[i * 3 + 2];
			if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(ay, by) < minY || Math.min(ay, by) > maxY) continue;
			const dx = bx - ax, dy = by - ay;
			const lengthMerc = Math.hypot(dx, dy);
			if (lengthMerc <= 0) continue;
			const length = lengthMerc * metresPerMerc;
			// Unit along and across the segment, in mercator units per metre.
			const ux = dx / lengthMerc / metresPerMerc, uy = dy / lengthMerc / metresPerMerc, nx = -uy, ny = ux;
			const corner = (along: number, across: number) => {
				const start = along < 0;
				vertex((start ? ax : bx) + ux * (start ? along : along - length) + nx * across, (start ? ay : by) + uy * (start ? along : along - length) + ny * across, start ? az : bz, along, across, length);
			};
			corner(-half, half); corner(-half, -half); corner(length + half, half);
			corner(length + half, half); corner(-half, -half); corner(length + half, -half);
		}
		this.routeDrawn = true;
		if (!out.length) return;
		const program = this.programs!.route;
		gl.useProgram(program);
		gl.uniform1f(gl.getUniformLocation(program, "u_edge"), edge);
		gl.uniformMatrix4fv(gl.getUniformLocation(program, "u_matrix"), false, translated(matrix, cx, cy));
		gl.enable(gl.BLEND);
		gl.blendEquation(gl.MAX);
		gl.blendFunc(gl.ONE, gl.ONE);
		gl.bindVertexArray(this.routeVao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.routeBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STREAM_DRAW);
		gl.drawArrays(gl.TRIANGLES, 0, out.length / 6);
		gl.blendEquation(gl.FUNC_ADD);
	}

	/** The fog bank, ray-marched at half resolution, then drawn to the screen with the route cut out. */
	private drawVolume(gl: WebGL2RenderingContext, matrix: number[], area: Area, zoom: number, time: number): void {
		const region = area.region, before = this.before;
		const canvas = this.canvas!, programs = this.programs!;
		// Local frame: origin at the region's centre, 1 unit ≈ 1 metre, z up (mercator z is conformal, so it scales the same).
		const s = 1 / region.metres;
		const local = multiply(matrix, [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, region.cx, region.cy, 0, 1]);
		const inverse = invert(local);
		if (!inverse) return;
		this.volumeTarget = this.target(gl, Math.max(1, Math.round(canvas.width * VOLUME_SCALE)), Math.max(1, Math.round(canvas.height * VOLUME_SCALE)), this.volumeTarget);
		const volume = this.volumeTarget;
		gl.bindFramebuffer(gl.FRAMEBUFFER, volume.framebuffer);
		gl.viewport(0, 0, volume.width, volume.height);
		gl.disable(gl.BLEND);
		const program = programs.volume;
		gl.useProgram(program);
		const at = (name: string) => gl.getUniformLocation(program, name);
		gl.uniformMatrix4fv(at("u_inverse"), false, new Float32Array(inverse));
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.display ?? area.mask.texture);
		gl.uniform1i(at("u_mask"), 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, area.height);
		gl.uniform1i(at("u_height"), 1);
		// The previous seen map and heights, while they fade out.
		const blend = before ? Math.min(1, (performance.now() - this.blendStart) / BLEND_MS) : 1;
		gl.activeTexture(gl.TEXTURE2);
		gl.bindTexture(gl.TEXTURE_2D, (before ?? area).mask.texture);
		gl.uniform1i(at("u_maskBefore"), 2);
		gl.activeTexture(gl.TEXTURE3);
		gl.bindTexture(gl.TEXTURE_2D, (before ?? area).height);
		gl.uniform1i(at("u_heightBefore"), 3);
		gl.uniform1f(at("u_blend"), blend * blend * (3 - 2 * blend));
		const was = (before ?? area).region;
		gl.uniform3f(at("u_before"), (was.cx - region.cx) * region.metres, (was.cy - region.cy) * region.metres, was.half * region.metres);
		// Ground range covering both while they blend.
		const groundLow = before ? Math.min(region.groundLow, was.groundLow) : region.groundLow;
		const groundHigh = before ? Math.max(region.groundHigh, was.groundHigh) : region.groundHigh;
		const halfMetres = region.half * region.metres;
		gl.uniform1f(at("u_half"), halfMetres);
		gl.uniform1f(at("u_low"), groundLow);
		gl.uniform1f(at("u_high"), groundHigh);
		// As tall as about 140 screen pixels, easing into FOG_HEIGHT_M close up: zoomed out, the bank keeps its shape on
		// screen instead of flattening into a sheet. Close up the camera can be lower than the bank's top: over a clearing
		// it looks out at the walls; over unexplored ground it is in the fog.
		const metresPerPixel = region.metres / (512 * 2 ** zoom);
		const fogHeight = Math.hypot(FOG_HEIGHT_M, 140 * metresPerPixel);
		gl.uniform1f(at("u_fogHeight"), fogHeight);
		// The bank stops getting shallower once it is FOG_HEIGHT_M tall, so its billows stop getting narrower there too.
		// Zooming further in, mounds sized to the screen would be a few metres across but 150 m tall: spikes. Past that
		// zoom the noise keeps its size on the ground and simply gets bigger on screen, like the bank itself.
		const noiseZoom = Math.min(zoom, Math.log2(region.metres / (512 * (FOG_HEIGHT_M / 140))));
		const billowMetresPerPixel = region.metres / (512 * 2 ** noiseZoom);
		// The sun in the north-west (north is -y here), a step a tenth of a fog billow long.
		const step = 30 * billowMetresPerPixel;
		gl.uniform2f(at("u_sun"), -0.6 * step, -0.8 * step);
		// How far a ray is followed: out to the edge of the seen map (all fog beyond), so rays skimming the bank's tops
		// reach real fog rather than stopping short in a flat grey band. Samples bunch up near the camera, so this costs
		// nothing close by.
		// (From the view's own size, which follows the zoom smoothly: the area's power-of-two size doubles in steps, and
		// the fog's reach and haze jumped with it.)
		const viewMetres = region.wanted * region.metres;
		gl.uniform1f(at("u_reach"), Math.max(viewMetres * 3, fogHeight * 12));
		gl.uniform1f(at("u_time"), time);
		const { octaves, amps, broadAmps } = octaveSet(noiseZoom, region);
		gl.uniform4fv(at("u_octave"), octaves);
		gl.uniform1fv(at("u_amp"), amps);
		gl.uniform1fv(at("u_ampBroad"), broadAmps);
		// The large-scale variation's place between octaves 0 and 1: 0 → 1 as the zoom rises to where the octaves shift up
		// a slot, at which point octave 1 becomes octave 0, so it carries straight on.
		gl.uniform1f(at("u_macroMix"), noiseZoom - 1.7 - (Math.ceil(noiseZoom - 1.7) - 1));
		// Haze over about three screens' worth of ground.
		gl.uniform1f(at("u_hazeDistance"), viewMetres * 0.9);
		gl.uniform1f(at("u_cell"), region.metres / CELLS);
		// Mapbox's camera sees about 36.9° top to bottom.
		gl.uniform1f(at("u_pixel"), (2 * Math.tan((36.87 * Math.PI) / 360)) / volume.height);
		// The car's live (smoothly moving) position: the fog round it clears every frame.
		const car = this.puckSource?.();
		if (car) gl.uniform3f(at("u_aura"), ((car[0] + 180) / 360 - region.cx) * region.metres, (mercY(car[1]) - region.cy) * region.metres, REVEAL_RADIUS_M);
		else gl.uniform3f(at("u_aura"), 0, 0, 0);
		gl.bindVertexArray(this.screen);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		this.readPuckFog(gl, volume);

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		const composite = programs.composite;
		gl.useProgram(composite);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, volume.texture);
		gl.uniform1i(gl.getUniformLocation(composite, "u_volume"), 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.routeTarget!.texture);
		gl.uniform1i(gl.getUniformLocation(composite, "u_route"), 1);
		gl.uniform1f(gl.getUniformLocation(composite, "u_solid"), fogSolidity(zoom));
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	/**
	 * How much fog covers the car on screen: the fog's opacity in a small patch at the car's spot. Read back without
	 * stalling (into a buffer the GPU fills in its own time, collected a frame or two later), so it costs nothing per frame.
	 */
	private readPuckFog(gl: WebGL2RenderingContext, volume: Target): void {
		if (!this.onPuckFog) return;
		let read = this.puckRead;
		if (!read) {
			const buffer = gl.createBuffer()!;
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
			gl.bufferData(gl.PIXEL_PACK_BUFFER, 9 * 4, gl.STREAM_READ);
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
			read = this.puckRead = { buffer, sync: null };
		}
		// Collect the last read, once the GPU has done it.
		if (read.sync) {
			const status = gl.clientWaitSync(read.sync, 0, 0);
			if (status === gl.TIMEOUT_EXPIRED) return;
			gl.deleteSync(read.sync);
			read.sync = null;
			if (status !== gl.WAIT_FAILED) {
				const pixels = new Uint8Array(9 * 4);
				gl.bindBuffer(gl.PIXEL_PACK_BUFFER, read.buffer);
				gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
				gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
				let alpha = 0;
				for (let i = 3; i < pixels.length; i += 4) alpha += pixels[i];
				this.onPuckFog(alpha / (9 * 255));
			}
		}
		// Ask for the next one: a 3×3 patch at the car (the fog volume is the framebuffer bound now).
		const puck = this.puckSource?.();
		const map = this.map, canvas = this.canvas;
		if (!puck || !map || !canvas) { this.onPuckFog(0); return; }
		const point = map.project(puck);
		const x = Math.round((point.x / canvas.clientWidth) * volume.width), y = Math.round((1 - point.y / canvas.clientHeight) * volume.height);
		if (x < 1 || y < 1 || x > volume.width - 2 || y > volume.height - 2) { this.onPuckFog(0); return; }
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, read.buffer);
		gl.readPixels(x - 1, y - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, 0);
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
		read.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
	}

	/**
	 * The globe's fog. On its own (`fadeOver` null) it is drawn straight onto a cleared canvas, overwriting rather than
	 * blending: the world's copies either side of the date line overlap while the globe flattens, and with see-through
	 * fog each overlap would add up darker. Over the 3D bank (just past zoom 6) it cross-fades by `fadeOver`, so the two
	 * together are never more solid than either.
	 */
	private drawGlobe(gl: WebGL2RenderingContext, matrix: number[], toMerc: number[], transition: number, time: number, solidity: number, fadeOver: number | null): void {
		const canvas = this.canvas!, program = this.programs!.globe;
		const clear = fadeOver === null;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, canvas.width, canvas.height);
		if (clear) {
			gl.clearColor(0, 0, 0, 0);
			gl.clearDepth(1);
			gl.depthMask(true);
			gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
			gl.disable(gl.BLEND);
			// Where the world's copies overlap as it flattens, the nearer surface wins (as Mapbox draws them), rather than
			// whichever was drawn last, which showed another part of the world's fog as a band.
			gl.enable(gl.DEPTH_TEST);
			gl.depthFunc(gl.LEQUAL);
		} else {
			gl.enable(gl.BLEND);
			gl.blendEquation(gl.FUNC_ADD);
			gl.blendColor(0, 0, 0, fadeOver);
			gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
		}
		gl.useProgram(program);
		gl.uniformMatrix4fv(gl.getUniformLocation(program, "u_matrix"), false, Float32Array.from(matrix));
		gl.uniformMatrix4fv(gl.getUniformLocation(program, "u_globeToMerc"), false, Float32Array.from(toMerc));
		const { octaves, amps } = octaveSet(this.map!.getZoom());
		gl.uniform4fv(gl.getUniformLocation(program, "u_octave"), octaves);
		gl.uniform1fv(gl.getUniformLocation(program, "u_amp"), amps);
		gl.uniform1f(gl.getUniformLocation(program, "u_transition"), transition);
		gl.uniform1f(gl.getUniformLocation(program, "u_time"), time);
		gl.uniform1f(gl.getUniformLocation(program, "u_alpha"), solidity);
		// Only a round globe has a far side to hide; fading over the flat map, every face counts.
		if (clear) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);
		gl.bindVertexArray(this.globe!.vao);
		// While the globe flattens, the map either side of the date line is drawn from the neighbouring world copies.
		const copy = gl.getUniformLocation(program, "u_copy");
		for (const shift of transition > 0 ? [-1, 0, 1] : [0]) {
			gl.uniform1f(copy, shift);
			gl.drawArrays(gl.TRIANGLES, 0, this.globe!.count);
		}
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.DEPTH_TEST);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
	}

	private upload(gl: WebGL2RenderingContext, chunk: Chunk): void {
		const originX = (chunk.x * CHUNK_SIZE) / CELLS, originY = (chunk.y * CHUNK_SIZE) / CELLS;
		const data = new Float32Array(chunk.keys.length * 3);
		for (let i = 0; i < chunk.keys.length; i++) {
			data[i * 3] = (cellX(chunk.keys[i]) + 0.5) / CELLS - originX;
			data[i * 3 + 1] = (cellY(chunk.keys[i]) + 0.5) / CELLS - originY;
			data[i * 3 + 2] = chunk.born[i];
		}
		if (!chunk.buffer) chunk.buffer = gl.createBuffer();
		if (!chunk.vao) {
			chunk.vao = gl.createVertexArray();
			gl.bindVertexArray(chunk.vao);
			const program = this.programs!.mask;
			const corner = gl.getAttribLocation(program, "a_corner"), cell = gl.getAttribLocation(program, "a_cell");
			gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
			gl.enableVertexAttribArray(corner);
			gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, chunk.buffer);
			gl.enableVertexAttribArray(cell);
			gl.vertexAttribPointer(cell, 3, gl.FLOAT, false, 0, 0);
			gl.vertexAttribDivisor(cell, 1);
		}
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, chunk.buffer);
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
		chunk.count = chunk.keys.length;
		chunk.dirty = false;
	}

	private freeChunk(chunk: Chunk): void {
		const gl = this.gl;
		if (gl && chunk.buffer) gl.deleteBuffer(chunk.buffer);
		if (gl && chunk.vao) gl.deleteVertexArray(chunk.vao);
		chunk.buffer = null;
		chunk.vao = null;
	}

	/** The whole Earth, wrapped in fog for the globe view. */
	private buildGlobe(gl: WebGL2RenderingContext): void {
		// Fine enough that its flat facets follow the curve of the Earth closely, even at the horizon.
		const columns = 256, rows = 128;
		const ecef: number[] = [], merc: number[] = [];
		const vertex = (i: number, j: number) => {
			const lng = -180 + (360 * i) / columns, lat = 90 - (180 * j) / rows;
			const phi = (lat * Math.PI) / 180, lambda = (lng * Math.PI) / 180;
			ecef.push(Math.cos(phi) * Math.sin(lambda) * GLOBE_RADIUS, -Math.sin(phi) * GLOBE_RADIUS, Math.cos(phi) * Math.cos(lambda) * GLOBE_RADIUS);
			merc.push((lng + 180) / 360, mercY(lat));
		};
		for (let j = 0; j < rows; j++) {
			for (let i = 0; i < columns; i++) {
				vertex(i, j); vertex(i, j + 1); vertex(i + 1, j);
				vertex(i + 1, j); vertex(i, j + 1); vertex(i + 1, j + 1);
			}
		}
		const program = this.programs!.globe;
		const vao = gl.createVertexArray()!;
		gl.bindVertexArray(vao);
		for (const [name, values, size] of [["a_ecef", ecef, 3], ["a_merc", merc, 2]] as const) {
			const buffer = gl.createBuffer()!;
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
			const location = gl.getAttribLocation(program, name);
			gl.enableVertexAttribArray(location);
			gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
		}
		gl.bindVertexArray(null);
		this.globe = { vao, count: ecef.length / 3 };
	}
}
