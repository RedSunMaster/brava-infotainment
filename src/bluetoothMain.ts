import { execFile, spawn, type ChildProcess } from "node:child_process";
import { app, ipcMain } from "electron";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
	MAC_PATTERN,
	parseController,
	parseDeviceInfo,
	parseDeviceList,
	type BluetoothAction,
	type BluetoothResult,
	type BluetoothState,
} from "./lib/bluetooth";

/**
 * Bluetooth pairing and connecting through `bluetoothctl` (BlueZ), the same way audioMain uses `pactl`.
 * A connected speaker or headset becomes an audio output by itself through PipeWire/PulseAudio.
 * Only pairings that need no PIN are supported (most speakers and headsets): there is no interactive agent here.
 */
const SCAN_SECONDS = 25;
const MAX_DEVICES = 40;

function ctl(args: string[], timeoutMs = 5000): Promise<{ ok: boolean; out: string }> {
	return new Promise((resolve) => {
		// LC_ALL=C keeps the output in the fixed English format the parsers expect.
		execFile("bluetoothctl", args, { timeout: timeoutMs, env: { ...process.env, LC_ALL: "C" } }, (error, stdout, stderr) =>
			resolve({ ok: !error, out: `${stdout}${stderr ?? ""}` }),
		);
	});
}

const lastLine = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";

let scan: ChildProcess | null = null;
const rememberedFile = () => join(app.getPath("userData"), "last-bluetooth-speaker");
function remember(mac: string) { try { writeFileSync(rememberedFile(), mac, { mode: 0o600 }); } catch { /* Connection still works without persistence. */ } }
function remembered(): string | null { try { const mac = readFileSync(rememberedFile(), "utf8").trim(); return MAC_PATTERN.test(mac) ? mac : null; } catch { return null; } }
let reconnecting = false;
async function reconnectSpeaker() {
	const mac = remembered();
	if (!mac || reconnecting || scan) return;
	reconnecting = true;
	try {
		const show = parseController((await ctl(["show"])).out);
		if (!show?.powered) return;
		const info = parseDeviceInfo(mac, "", (await ctl(["info", mac])).out);
		if (info.paired && !info.connected) await ctl(["connect", mac], 20000);
	} finally { reconnecting = false; }
}
async function rememberAudio(mac: string) {
	const info = parseDeviceInfo(mac, "", (await ctl(["info", mac])).out);
	if (info.paired && info.connected && /audio|headset|headphone/i.test(info.icon ?? "")) remember(mac);
}

function stopScan() {
	if (scan) { scan.kill(); scan = null; }
}
function startScan() {
	if (scan) return;
	// bluetoothctl keeps discovery on only while it runs, and --timeout ends it by itself.
	const child = spawn("bluetoothctl", ["--timeout", String(SCAN_SECONDS), "scan", "on"], { stdio: "ignore", env: { ...process.env, LC_ALL: "C" } });
	scan = child;
	const done = () => { if (scan === child) scan = null; };
	child.on("exit", done);
	child.on("error", done);
}

async function readState(): Promise<BluetoothState> {
	const show = await ctl(["show"]);
	const controller = show.ok ? parseController(show.out) : null;
	if (!controller) {
		return { available: false, powered: false, discovering: false, devices: [], error: show.ok ? "No Bluetooth adapter found." : "bluetoothctl is not available (is BlueZ installed and running?)." };
	}
	const list = (await ctl(["devices"])).out;
	const found = parseDeviceList(list).slice(0, MAX_DEVICES);
	const devices = await Promise.all(found.map(async ({ mac, name }) => parseDeviceInfo(mac, name, (await ctl(["info", mac])).out)));
	return { available: true, powered: controller.powered, discovering: controller.discovering || scan !== null, devices, error: null };
}

async function runAction(mac: string, action: BluetoothAction): Promise<BluetoothResult> {
	if (!MAC_PATTERN.test(mac)) return { ok: false, message: "Not a Bluetooth address." };
	switch (action) {
		case "pair": {
			// Pairing and discovery do not mix well on some adapters.
			stopScan();
			const paired = await ctl(["pair", mac], 40000);
			if (!paired.ok && !/AlreadyExists|already/i.test(paired.out)) {
				return { ok: false, message: /Authentication|PIN|passkey/i.test(paired.out) ? "This device needs a PIN, which is not supported here." : lastLine(paired.out) || "Pairing failed." };
			}
			// Trusted devices reconnect by themselves next time they are switched on.
			await ctl(["trust", mac]);
			const connected = await ctl(["connect", mac], 20000);
			if (connected.ok) await rememberAudio(mac);
			return connected.ok ? { ok: true, message: "Paired and connected." } : { ok: true, message: "Paired, but it did not connect. Switch it on and tap Connect." };
		}
		case "connect": {
			stopScan();
			const r = await ctl(["connect", mac], 20000);
			if (r.ok) await rememberAudio(mac);
			return r.ok ? { ok: true, message: "Connected." } : { ok: false, message: lastLine(r.out) || "Could not connect." };
		}
		case "disconnect": {
			if (remembered() === mac) { try { unlinkSync(rememberedFile()); } catch { /* Already removed. */ } }
			const r = await ctl(["disconnect", mac]);
			return r.ok ? { ok: true, message: "Disconnected." } : { ok: false, message: lastLine(r.out) || "Could not disconnect." };
		}
		case "forget": {
			if (remembered() === mac) { try { unlinkSync(rememberedFile()); } catch { /* Already removed. */ } }
			const r = await ctl(["remove", mac]);
			return r.ok ? { ok: true, message: "Removed." } : { ok: false, message: lastLine(r.out) || "Could not remove." };
		}
	}
}

export function registerBluetoothIpc(): void {
	if (process.platform !== "linux") {
		const none: BluetoothState = { available: false, powered: false, discovering: false, devices: [], error: "Bluetooth controls are only available on the car computer." };
		ipcMain.handle("bt:state", () => none);
		ipcMain.handle("bt:power", () => false);
		ipcMain.handle("bt:scan", () => false);
		ipcMain.handle("bt:action", () => ({ ok: false, message: none.error } as BluetoothResult));
		return;
	}
	const timer = setInterval(() => void reconnectSpeaker(), 30000);
	setTimeout(() => void reconnectSpeaker(), 5000);
	app.on("before-quit", () => clearInterval(timer));
	ipcMain.handle("bt:state", () => readState());
	ipcMain.handle("bt:power", async (_event, on: boolean) => {
		if (!on) stopScan();
		return (await ctl(["power", on ? "on" : "off"])).ok;
	});
	ipcMain.handle("bt:scan", async (_event, on: boolean) => {
		if (!on) { stopScan(); return true; }
		// Scanning needs the adapter on.
		await ctl(["power", "on"]);
		startScan();
		return true;
	});
	ipcMain.handle("bt:action", (_event, mac: string, action: BluetoothAction) => runAction(String(mac).toUpperCase(), action));
	app.on("before-quit", stopScan);
}
