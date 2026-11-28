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
	// Freeze the legacy value before Spotify writes a transient ducking or full-gain level.
	if (saved !== null && read(storage, LEVEL_KEY) === null) write(storage, LEVEL_KEY, String(state.level));
	const listeners = new Set<() => void>();
	const emit = () => listeners.forEach((listener) => listener());
	const set = (next: MasterState) => { state = next; emit(); };

	// Slider drags send many levels; only the newest matters, so one request is in flight and the rest collapse.
	let sending = false;
	let sent: { level: number; muted: boolean } | null = null;
	async function sync(probe = false) {
		if (sending || !mixer || (!probe && !sent)) return;
		sending = true;
		try {
			if (probe) {
				sent = await mixer.get();
				if (!sent) throw new Error("Mixer unavailable");
				if (saved === null && read(storage, LEVEL_KEY) === null && !state.system) {
					state = { ...state, level: displayLevel(sent.level), muted: read(storage, MUTE_KEY) === null ? sent.muted : state.muted };
					write(storage, LEVEL_KEY, String(state.level));
				}
			}
			while (sent) {
				const level = outputLevel(state.level);
				if (sent.level !== level) {
					if (!await mixer.setLevel(level)) throw new Error("Volume unavailable");
					sent.level = level;
					continue;
				}
				const muted = state.muted;
				if (sent.muted !== muted) {
					if (!await mixer.setMuted(muted)) throw new Error("Mute unavailable");
					sent.muted = muted;
					continue;
				}
				// Lift the app's own attenuation only after the output is at its mapped level.
				if (!state.system) set({ ...state, system: true });
				break;
			}
		} catch {
			sent = null;
			if (state.system) set({ ...state, system: false });
		} finally { sending = false; }
	}

	return {
		get(): MasterState { return state; },
		subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); },
		setLevel(level: number): void {
			const next = clamp(level);
			write(storage, LEVEL_KEY, String(next));
			// Raising the volume ends a mute, as it does on a phone or a car radio.
			if (state.muted && next > state.level) write(storage, MUTE_KEY, "false");
			set({ ...state, level: next, muted: state.muted && next <= state.level });
			void sync();
		},
		setMuted(muted: boolean): void {
			write(storage, MUTE_KEY, String(muted));
			set({ ...state, muted });
			void sync();
		},
		toggleMute(): void { this.setMuted(!state.muted); },
		/** Reconcile the current default output, including one restored or replaced after boot. */
		connect: () => sync(true),
	};
}

export type MasterVolume = ReturnType<typeof createMasterVolume>;
