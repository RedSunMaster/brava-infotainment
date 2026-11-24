/**
 * Pac-Man mode's sounds, made up in code in the arcade's style (square and triangle waves, quick pitch sweeps): the waka,
 * the start tune, the death slide, eating a ghost, a bonus blip, the power pellet's warble and the ghosts' siren. They are
 * imitations: the arcade's own recordings are used instead whenever they are in the sounds folder (see pacmanSoundFiles.ts).
 *
 * Pure maths with no audio device, so it can be tested on its own.
 */
export const SAMPLE_RATE = 22_050;

export type SoundName = "start" | "waka" | "wakaB" | "death" | "eatGhost" | "extra" | "power" | "siren";
/** The sounds that play over and over until stopped. */
export const LOOPING: readonly SoundName[] = ["power", "siren"];

type Wave = "square" | "triangle" | "sine";
const TAU = Math.PI * 2;
const ATTACK_S = 0.003;
const RELEASE_S = 0.01;

function oscillate(wave: Wave, phase: number): number {
	const p = phase - Math.floor(phase);
	if (wave === "square") return p < 0.5 ? 1 : -1;
	if (wave === "triangle") return 4 * Math.abs(p - 0.5) - 1;
	return Math.sin(TAU * p);
}

/** A tone gliding from `from` to `to` hertz, with a short fade in and out so there are no clicks. */
function sweep(seconds: number, from: number, to: number, wave: Wave, gain: number, decay = 0): number[] {
	const n = Math.max(1, Math.round(seconds * SAMPLE_RATE));
	const out: number[] = new Array<number>(n);
	let phase = 0;
	for (let i = 0; i < n; i++) {
		const t = i / SAMPLE_RATE, k = i / n;
		phase += (from + (to - from) * k) / SAMPLE_RATE;
		const fade = Math.min(1, t / ATTACK_S, (seconds - t) / RELEASE_S);
		out[i] = oscillate(wave, phase) * gain * Math.max(0, fade) * (1 - decay * k);
	}
	return out;
}
const rest = (seconds: number): number[] => new Array<number>(Math.round(seconds * SAMPLE_RATE)).fill(0);
const join = (...parts: number[][]): Float32Array => Float32Array.from(parts.flat());
const note = (hz: number, seconds: number, wave: Wave = "square", gain = 0.5): number[] => sweep(seconds, hz, hz, wave, gain, 0.25);

/** The first phrases of the start tune: note pitches in hertz and how long each is held. */
const TUNE: [number, number][] = [
	[493.9, 0.075], [987.8, 0.075], [740, 0.075], [622.3, 0.075], [987.8, 0.075], [740, 0.075], [622.3, 0.17],
	[523.3, 0.075], [1046.5, 0.075], [784, 0.075], [659.3, 0.075], [1046.5, 0.075], [784, 0.075], [659.3, 0.17],
	[493.9, 0.075], [987.8, 0.075], [740, 0.075], [622.3, 0.075], [987.8, 0.075], [740, 0.075], [622.3, 0.17],
	[622.3, 0.04], [659.3, 0.04], [698.5, 0.075], [698.5, 0.04], [740, 0.04], [784, 0.075], [784, 0.04], [830.6, 0.04], [880, 0.075], [987.8, 0.24],
];

/** The sound made, as samples from -1 to 1. */
export function synthesize(name: SoundName): Float32Array {
	switch (name) {
		// The waka: a quick rising sweep, then a falling one on the next dot.
		case "waka": return join(sweep(0.09, 300, 900, "square", 0.32, 0.4), rest(0.02));
		case "wakaB": return join(sweep(0.09, 900, 300, "square", 0.32, 0.4), rest(0.02));
		case "start": return join(...TUNE.flatMap(([hz, seconds]) => [note(hz, seconds, "square", 0.34), rest(0.012)]));
		// The death: a run of falling slides, each starting lower, and a pop.
		case "death": return join(...Array.from({ length: 10 }, (_, i) => sweep(0.13, 1_000 - i * 75, 260 - i * 12, "square", 0.34, 0.2)), sweep(0.12, 120, 40, "triangle", 0.5, 0.9));
		case "eatGhost": return join(sweep(0.34, 160, 1_900, "square", 0.34, 0.5));
		case "extra": return join(note(1_318.5, 0.07, "triangle", 0.5), note(1_760, 0.07, "triangle", 0.5), note(2_093, 0.12, "triangle", 0.5));
		// One loop of the power pellet's warble.
		case "power": return join(sweep(0.11, 330, 880, "triangle", 0.36), sweep(0.11, 880, 330, "triangle", 0.36));
		// One loop of the siren: up and down.
		case "siren": return join(sweep(0.5, 480, 880, "sine", 0.3), sweep(0.5, 880, 480, "sine", 0.3));
	}
}
