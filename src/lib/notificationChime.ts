import { audioDucking, DUCK_LEAD_S } from "./audioDucking";

let context: AudioContext | null = null;

/** Loudest the chime gets, at a level of 1. The master volume (the system mixer) still scales it. */
const PEAK = 0.5;
const NOTES: { hz: number; at: number }[] = [{ hz: 880, at: 0 }, { hz: 1318.5, at: 0.14 }];
const NOTE_S = 0.32;

/**
 * Plays the short two-note sound for an arriving notification at `level` (0 to 1). Music is lowered while it plays,
 * by the same "Music while speaking" amount used for spoken prompts.
 */
export function playChime(level: number): void {
	if (!(level > 0) || typeof AudioContext === "undefined") return;
	try {
		context ??= new AudioContext();
		const ctx = context;
		void ctx.resume();
		const release = audioDucking.begin();
		const start = ctx.currentTime + DUCK_LEAD_S;
		for (const { hz, at } of NOTES) {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "sine";
			osc.frequency.value = hz;
			const t = start + at;
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, PEAK * level), t + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + NOTE_S);
			osc.connect(gain).connect(ctx.destination);
			osc.start(t);
			osc.stop(t + NOTE_S + 0.05);
		}
		const total = NOTES[NOTES.length - 1].at + NOTE_S;
		setTimeout(release, (DUCK_LEAD_S + total) * 1000);
	} catch { /* No sound is better than breaking the notification. */ }
}
