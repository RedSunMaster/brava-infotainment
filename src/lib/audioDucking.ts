/**
 * Lets spoken guidance lower the music while it talks. Anything that speaks calls `begin()`
 * and calls the returned function when it has finished; listeners are told when the music
 * should go down and when it can come back.
 */
export type DuckListener = (ducked: boolean) => void;

/** Music is played at this fraction of its volume while a prompt is spoken. */
export const DUCK_FACTOR = 0.3;
/** Speech starts this long after the duck is requested, so the music has begun to drop. */
export const DUCK_LEAD_S = 0.3;

export function duckedVolume(percent: number): number {
	return Math.max(0, Math.round(percent * DUCK_FACTOR));
}

export function createDucking(releaseMs = 800, maxHoldMs = 20_000) {
	const listeners = new Set<DuckListener>();
	let holds = 0;
	let ducked = false;
	let releaseTimer: ReturnType<typeof setTimeout> | null = null;

	function set(next: boolean) {
		if (ducked === next) return;
		ducked = next;
		listeners.forEach((listener) => listener(next));
	}

	return {
		get ducked() { return ducked; },
		/** Starts a hold on the music volume. Call the result when speech ends; extra calls are ignored. */
		begin(): () => void {
			holds++;
			if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
			set(true);
			let released = false;
			let safety: ReturnType<typeof setTimeout> | null = null;
			const release = () => {
				if (released) return;
				released = true;
				if (safety) clearTimeout(safety);
				holds = Math.max(0, holds - 1);
				// A short delay keeps the music down across back-to-back phrases instead of pumping.
				if (holds === 0 && !releaseTimer) releaseTimer = setTimeout(() => { releaseTimer = null; if (holds === 0) set(false); }, releaseMs);
			};
			// If the end of speech is never reported, do not leave the music quiet for good.
			safety = setTimeout(release, maxHoldMs);
			return release;
		},
		subscribe(listener: DuckListener): () => void {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export const audioDucking = createDucking();
