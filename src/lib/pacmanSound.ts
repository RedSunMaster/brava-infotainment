import { audioDucking, DUCK_LEAD_S } from "./audioDucking";
import { LOOPING, SAMPLE_RATE, synthesize, type SoundName } from "./pacmanSynth";

/**
 * Pac-Man mode's sound effects. Each sound is the arcade's own recording if there is one (bundled in public/sounds/pacman) and otherwise an imitation made up in code (pacmanSynth.ts). They are cues, not music: short, and
 * all scaled by the sound level setting and the car's master volume. The start tune and the death sound lower the music while
 * they play, as the notification chime does.
 */

/** How loud each sound is at a level of 1, before the master volume. */
const PEAK: Record<SoundName, number> = { start: 0.7, waka: 0.55, wakaB: 0.55, death: 0.8, eatGhost: 0.75, extra: 0.65, power: 0.3, siren: 0.2 };
/** These lower the music for as long as they last. */
const DUCKS: readonly SoundName[] = ["start", "death"];

interface Loop { source: AudioBufferSourceNode; gain: GainNode }

export class PacmanSounds {
	private context: AudioContext | null = null;
	private buffers = new Map<SoundName, AudioBuffer>();
	private recorded = new Set<SoundName>();
	private loops = new Map<SoundName, Loop>();
	private level = 0;
	private flip = false;

	/** `scale` is what the master volume is worth now (1 when the system output does it). */
	constructor(private scale: () => number) {}

	/** Which sounds are the arcade's own recordings rather than imitations. */
	recordings(): SoundName[] { return [...this.recorded]; }

	setLevel(level: number): void {
		this.level = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
		if (this.level === 0) this.stopAll();
	}

	/** Takes the recordings in `files` (undecoded file contents) in place of the imitations. Ones that cannot be read are skipped. */
	async useFiles(files: Partial<Record<SoundName, ArrayBuffer>>): Promise<void> {
		const ctx = this.audio();
		if (!ctx) return;
		for (const [name, data] of Object.entries(files) as [SoundName, ArrayBuffer][]) {
			try {
				this.buffers.set(name, await ctx.decodeAudioData(data.slice(0)));
				this.recorded.add(name);
			} catch { /* Not audio the browser can read: the imitation stays. */ }
		}
	}

	private audio(): AudioContext | null {
		if (typeof AudioContext === "undefined") return null;
		try { this.context ??= new AudioContext(); void this.context.resume(); return this.context; } catch { return null; }
	}

	private buffer(name: SoundName): AudioBuffer | null {
		const known = this.buffers.get(name);
		if (known) return known;
		const ctx = this.audio();
		if (!ctx) return null;
		const samples = synthesize(name);
		const made = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
		made.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
		this.buffers.set(name, made);
		return made;
	}

	private volume(name: SoundName, extra = 1): number { return PEAK[name] * this.level * this.scale() * extra; }

	/** Plays a sound once. The waka alternates its two halves each time it is asked for, as the arcade's does. */
	play(name: SoundName): void {
		if (this.level <= 0 || LOOPING.includes(name)) return;
		let which = name;
		if (name === "waka") { this.flip = !this.flip; if (this.flip && (this.recorded.has("wakaB") || !this.recorded.has("waka"))) which = "wakaB"; }
		const ctx = this.audio(), buffer = this.buffer(which);
		if (!ctx || !buffer) return;
		try {
			const source = ctx.createBufferSource(), gain = ctx.createGain();
			source.buffer = buffer;
			gain.gain.value = Math.min(1, this.volume(which));
			source.connect(gain).connect(ctx.destination);
			if (DUCKS.includes(name)) {
				const release = audioDucking.begin();
				source.start(ctx.currentTime + DUCK_LEAD_S);
				setTimeout(release, (DUCK_LEAD_S + buffer.duration) * 1000);
			} else source.start();
		} catch { /* No sound is better than breaking the game. */ }
	}

	/** Starts, changes or stops a looping sound (the power pellet's warble, the siren). */
	setLoop(name: SoundName, on: boolean, { volume = 1, rate = 1 }: { volume?: number; rate?: number } = {}): void {
		const running = this.loops.get(name);
		if (!on || this.level <= 0) {
			if (running) { try { running.source.stop(); } catch { /* Already stopped. */ } this.loops.delete(name); }
			return;
		}
		const ctx = this.audio();
		if (!ctx) return;
		const gain = Math.min(1, this.volume(name, volume));
		if (running) { running.gain.gain.setTargetAtTime(gain, ctx.currentTime, 0.05); running.source.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.1); return; }
		const buffer = this.buffer(name);
		if (!buffer) return;
		try {
			const source = ctx.createBufferSource(), node = ctx.createGain();
			source.buffer = buffer;
			source.loop = true;
			source.playbackRate.value = rate;
			node.gain.value = gain;
			source.connect(node).connect(ctx.destination);
			source.start();
			this.loops.set(name, { source, gain: node });
		} catch { /* No sound is better than breaking the game. */ }
	}

	stopAll(): void { for (const name of [...this.loops.keys()]) this.setLoop(name, false); }

	dispose(): void {
		this.stopAll();
		try { void this.context?.close(); } catch { /* Already closed. */ }
		this.context = null;
		this.buffers.clear();
	}
}
