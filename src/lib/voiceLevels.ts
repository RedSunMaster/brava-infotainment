/**
 * How loud each kind of spoken prompt is, and how far the music drops while one is spoken. These sit under the master
 * volume: the master moves everything together, these set the balance between music, turn guidance and alerts.
 */
export interface VoiceLevels {
	/** Turn-by-turn guidance, 0 to 1. */
	guidance: number;
	/** Warnings and notices (road closures, cameras, faster route, rerouting), 0 to 1. */
	alerts: number;
	/** How loud the music stays while a prompt is spoken, 0 to 1 of its normal level. */
	music: number;
}
export type VoiceKind = "guidance" | "alerts";
type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const VOICE_KEYS: Record<keyof VoiceLevels, string> = { guidance: "brava-voice-volume", alerts: "brava-voice-volume-alerts", music: "brava-duck-level" };
export const VOICE_DEFAULTS: VoiceLevels = { guidance: 1, alerts: 1, music: 0.3 };

const clamp = (value: number) => Math.min(1, Math.max(0, Math.round(value * 100) / 100));

export function createVoiceLevels(storage: StorageLike | null) {
	const levels: VoiceLevels = { ...VOICE_DEFAULTS };
	for (const name of Object.keys(VOICE_KEYS) as (keyof VoiceLevels)[]) {
		try {
			const raw = storage?.getItem(VOICE_KEYS[name]) ?? null;
			if (raw !== null && Number.isFinite(Number(raw))) levels[name] = clamp(Number(raw));
		} catch { /* Use the default. */ }
	}
	let state: VoiceLevels = levels;
	const listeners = new Set<() => void>();
	return {
		get: () => state,
		subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); },
		set(name: keyof VoiceLevels, value: number): void {
			const next = clamp(value);
			state = { ...state, [name]: next };
			try { storage?.setItem(VOICE_KEYS[name], String(next)); } catch { /* Kept for this session only. */ }
			listeners.forEach((listener) => listener());
		},
		/** Re-reads everything, for when the active driver profile changes. */
		reload(): void {
			const fresh = createVoiceLevels(storage).get();
			state = fresh;
			listeners.forEach((listener) => listener());
		},
	};
}
