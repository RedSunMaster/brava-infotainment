import { execFile } from "node:child_process";
import { ipcMain } from "electron";

/**
 * System output volume for the master volume control. Uses `pactl`, which both PulseAudio and PipeWire (pipewire-pulse,
 * the default on current Ubuntu and Fedora) provide. Off Linux, or without pactl, every call reports "not available"
 * and the app falls back to scaling its own sound.
 */
const SINK = "@DEFAULT_SINK@";

function pactl(args: string[]): Promise<string | null> {
	return new Promise((resolve) => {
		// LC_ALL=C keeps the output in a fixed English format that parseVolume/parseMute understand.
		execFile("pactl", args, { timeout: 3000, env: { ...process.env, LC_ALL: "C" } }, (error, stdout) => resolve(error ? null : stdout));
	});
}

/** "Volume: front-left: 32768 /  50% / -18.06 dB, front-right: ..." → 50 */
export function parseVolume(output: string): number | null {
	const match = /(\d+)%/.exec(output);
	return match ? Math.min(100, Number(match[1])) : null;
}
/** "Mute: yes" → true */
export function parseMute(output: string): boolean | null {
	const match = /Mute:\s*(yes|no)/i.exec(output);
	return match ? match[1].toLowerCase() === "yes" : null;
}

export function registerAudioIpc(): void {
	if (process.platform !== "linux") {
		ipcMain.handle("audio:get", () => null);
		ipcMain.handle("audio:set-level", () => false);
		ipcMain.handle("audio:set-muted", () => false);
		return;
	}
	ipcMain.handle("audio:get", async () => {
		const [volume, mute] = await Promise.all([pactl(["get-sink-volume", SINK]), pactl(["get-sink-mute", SINK])]);
		const level = volume ? parseVolume(volume) : null;
		const muted = mute ? parseMute(mute) : null;
		return level === null || muted === null ? null : { level, muted };
	});
	ipcMain.handle("audio:set-level", async (_event, level: number) => {
		if (!Number.isFinite(level)) return false;
		return (await pactl(["set-sink-volume", SINK, `${Math.min(100, Math.max(0, Math.round(level)))}%`])) !== null;
	});
	ipcMain.handle("audio:set-muted", async (_event, muted: boolean) => (await pactl(["set-sink-mute", SINK, muted ? "1" : "0"])) !== null);
}
