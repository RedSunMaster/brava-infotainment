/**
 * The car's master volume: one level and one mute for everything that makes sound, whether or not Spotify is connected.
 *
 * On the car computer it is the system output (PulseAudio/PipeWire), so music, spoken guidance and later phone calls
 * all follow it. Where there is no system mixer (a development PC) it falls back to an in-app multiplier: the music
 * player is set to the level and the voice is scaled by it.
 */
export interface MasterState { level: number; muted: boolean; /** True when the level drives the system output rather than just this app. */ system: boolean }

export interface SystemMixer {
	get(): Promise<{ level: number; muted: boolean } | null>;
	setLevel(level: number): Promise<boolean>;
	setMuted(muted: boolean): Promise<boolean>;
}
type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const LEVEL_KEY = "brava-master-volume";
export const MUTE_KEY = "brava-master-muted";
/** The level used when nothing was saved and the system cannot be asked. */
export const DEFAULT_LEVEL = 50;

/**
 * The loudest the car output is allowed to be, in percent of the real output. The volume shown and set in the app runs 0 to 100, and
 * 100 means this: the full output was far too loud in the car, so what the app calls 100 is 80 on the output itself.
 */
export const OUTPUT_CEILING = 80;
/** The real output level (0-100) for a level shown in the app. */
export const outputLevel = (level: number): number => Math.round((Math.min(100, Math.max(0, level)) * OUTPUT_CEILING) / 100);
/** The level to show in the app for a real output level. */
export const displayLevel = (output: number): number => Math.min(100, Math.max(0, Math.round((output * 100) / OUTPUT_CEILING)));

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(Number.isFinite(value) ? value : DEFAULT_LEVEL)));

function read(storage: StorageLike | null, key: string): string | null {
	try { return storage?.getItem(key) ?? null; } catch { return null; }
}
function write(storage: StorageLike | null, key: string, value: string): void {
	try { storage?.setItem(key, value); } catch { /* Kept for this session only. */ }
}

/** What the output is worth to code that has to scale its own sound: 1 when the system mixer does it, else the level. */
export function appScale(state: MasterState): number {
	if (state.system) return 1;
	return state.muted ? 0 : outputLevel(state.level) / 100;
}

export function createMasterVolume(storage: StorageLike | null, mixer: SystemMixer | null = null) {
	// The first run adopts the old Spotify volume so the car does not suddenly get louder or quieter.
	const saved = read(storage, LEVEL_KEY) ?? read(storage, "brava-spotify-volume");
	let state: MasterState = { level: saved === null ? DEFAULT_LEVEL : clamp(Number(saved)), muted: read(storage, MUTE_KEY) === "true", system: false };
	const listeners = new Set<() => void>();
	const emit = () => listeners.forEach((listener) => listener());
	const set = (next: MasterState) => { state = next; emit(); };

	// Slider drags send many levels; only the newest matters, so one request is in flight and the rest collapse.
	let sending = false;
	let wanted: { level: number; muted: boolean } | null = null;
	let sent = { level: -1, muted: false };
	async function flush() {
		if (sending || !mixer || !state.system) return;
		sending = true;
		try {
			while (wanted) {
				const next = wanted;
				wanted = null;
				if (outputLevel(next.level) !== sent.level) { if (await mixer.setLevel(outputLevel(next.level))) sent.level = outputLevel(next.level); }
				if (next.muted !== sent.muted) { if (await mixer.setMuted(next.muted)) sent.muted = next.muted; }
			}
		} finally { sending = false; }
	}
	function push() { wanted = { level: state.level, muted: state.muted }; void flush(); }

	return {
		get(): MasterState { return state; },
		subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); },
		setLevel(level: number): void {
			const next = clamp(level);
			write(storage, LEVEL_KEY, String(next));
			// Raising the volume ends a mute, as it does on a phone or a car radio.
			if (state.muted && next > state.level) write(storage, MUTE_KEY, "false");
			set({ ...state, level: next, muted: state.muted && next <= state.level });
			push();
		},
		setMuted(muted: boolean): void {
			write(storage, MUTE_KEY, String(muted));
			set({ ...state, muted });
			push();
		},
		toggleMute(): void { this.setMuted(!state.muted); },
		/** Looks for a system mixer. Call once at start-up; the saved level is applied to the system so the car starts as it was left. */
		async connect(): Promise<void> {
			if (!mixer) return;
			let current: { level: number; muted: boolean } | null = null;
			try { current = await mixer.get(); } catch { current = null; }
			if (!current) return;
			const hasSaved = read(storage, LEVEL_KEY) !== null || read(storage, "brava-spotify-volume") !== null;
			sent = { level: current.level, muted: current.muted };
			// With nothing saved, trust what the system says; otherwise put the system back where the driver left it.
			set(hasSaved ? { ...state, system: true } : { level: displayLevel(current.level), muted: current.muted, system: true });
			push();
		},
	};
}

export type MasterVolume = ReturnType<typeof createMasterVolume>;
