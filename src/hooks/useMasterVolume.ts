import { useEffect, useSyncExternalStore } from "react";
import { createMasterVolume, type SystemMixer } from "../lib/masterVolume";
import { createVoiceLevels } from "../lib/voiceLevels";

interface ElectronAudio {
	get(): Promise<{ level: number; muted: boolean } | null>;
	setLevel(level: number): Promise<boolean>;
	setMuted(muted: boolean): Promise<boolean>;
}
const bridge = (): SystemMixer | null => (typeof window === "undefined" ? null : ((window as unknown as { electronAudio?: ElectronAudio }).electronAudio ?? null));
const storage = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

/** One master volume and one set of voice levels for the whole app, shared by every control that shows or changes them. */
export const masterVolume = createMasterVolume(storage(), bridge());
export const voiceLevels = createVoiceLevels(storage());

let started = false;
function start() { if (!started) { started = true; void masterVolume.connect(); } }

export function useMasterVolume() {
	useEffect(start, []);
	const state = useSyncExternalStore(masterVolume.subscribe, masterVolume.get, masterVolume.get);
	return { ...state, setLevel: (level: number) => masterVolume.setLevel(level), setMuted: (muted: boolean) => masterVolume.setMuted(muted), toggleMute: () => masterVolume.toggleMute() };
}

export function useVoiceLevels() {
	const levels = useSyncExternalStore(voiceLevels.subscribe, voiceLevels.get, voiceLevels.get);
	return { levels, setLevel: voiceLevels.set };
}
