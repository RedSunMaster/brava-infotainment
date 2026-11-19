import { app, BrowserWindow, ipcMain } from "electron";
import { createConnection, type Socket } from "net";
import type { GpsDebugSnapshot } from "./lib/gpsDebug";

const GPSD_HOST = "localhost";
const GPSD_PORT = 2947;
const RETRY_MS = 5000;
// The debug view is pushed at most once a second; gpsd can send several messages per second.
const DEBUG_PUSH_MS = 1000;

const debug: GpsDebugSnapshot = {
	daemon: "connecting",
	host: `${GPSD_HOST}:${GPSD_PORT}`,
	version: null,
	connectedSince: null,
	lastMessageAt: null,
	lastError: null,
	reconnects: 0,
	messageCounts: {},
	devices: [],
	tpv: null,
	sky: null,
};

let shuttingDown = false;
app.on("before-quit", () => { shuttingDown = true; });

function str(v: unknown): string | null { return typeof v === "string" ? v : null; }
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }

function handleMessage(msg: any, win: BrowserWindow, client: Socket) {
	debug.lastMessageAt = Date.now();
	const cls = String(msg.class ?? "?");
	debug.messageCounts[cls] = (debug.messageCounts[cls] ?? 0) + 1;

	switch (cls) {
		case "VERSION":
			debug.version = str(msg.release) ?? str(msg.rev);
			client.write('?WATCH={"enable":true,"json":true}\n');
			client.write("?DEVICES;\n");
			break;
		case "DEVICES":
		case "DEVICE": {
			const list: any[] = cls === "DEVICES" ? (Array.isArray(msg.devices) ? msg.devices : []) : [msg];
			for (const d of list) {
				const path = str(d.path);
				if (!path) continue;
				const entry = {
					path,
					driver: str(d.driver),
					subtype: str(d.subtype),
					activated: str(d.activated),
					bps: num(d.bps),
					flags: num(d.flags),
				};
				const i = debug.devices.findIndex((x) => x.path === path);
				if (i >= 0) debug.devices[i] = { ...debug.devices[i], ...entry };
				else debug.devices.push(entry);
			}
			// A DEVICES list is the full set, so anything missing from it has been unplugged.
			if (cls === "DEVICES") debug.devices = debug.devices.filter((x) => list.some((d) => d.path === x.path));
			break;
		}
		case "WATCH":
			break;
		case "TPV":
			debug.tpv = {
				mode: num(msg.mode) ?? 0,
				time: str(msg.time),
				lat: num(msg.lat),
				lon: num(msg.lon),
				alt: num(msg.altHAE) ?? num(msg.alt),
				speed: num(msg.speed),
				track: num(msg.track),
				climb: num(msg.climb),
				epx: num(msg.epx),
				epy: num(msg.epy),
				epv: num(msg.epv),
				eps: num(msg.eps),
				device: str(msg.device),
				receivedAt: Date.now(),
			};
			win.webContents.send("gps-update", {
				lat: msg.lat ?? null,
				lon: msg.lon ?? null,
				speed: msg.speed ?? 0,
				track: msg.track ?? null,
				mode: msg.mode ?? 0,
			});
			break;
		case "SKY": {
			const sats: any[] = Array.isArray(msg.satellites) ? msg.satellites : [];
			debug.sky = {
				satellites: sats.map((s) => ({
					prn: num(s.PRN) ?? 0,
					gnss: num(s.gnssid),
					el: num(s.el),
					az: num(s.az),
					ss: num(s.ss),
					used: s.used === true,
				})),
				hdop: num(msg.hdop),
				vdop: num(msg.vdop),
				pdop: num(msg.pdop),
				device: str(msg.device),
				receivedAt: Date.now(),
			};
			break;
		}
		case "ERROR":
			debug.lastError = str(msg.message) ?? "gpsd reported an error";
			break;
	}
}

export function startGps(win: BrowserWindow) {
	let retryTimer: NodeJS.Timeout | null = null;
	let client: Socket | null = null;

	const pushDebug = () => { if (!win.isDestroyed()) win.webContents.send("gps-debug", debug); };
	const pushTimer = setInterval(pushDebug, DEBUG_PUSH_MS);
	ipcMain.removeHandler("gps-debug-get");
	ipcMain.handle("gps-debug-get", () => debug);

	app.on("before-quit", () => { clearInterval(pushTimer); client?.destroy(); });
	win.on("closed", () => clearInterval(pushTimer));

	const connect = () => {
		if (shuttingDown || win.isDestroyed()) return;
		debug.daemon = "connecting";
		const sock = createConnection({ port: GPSD_PORT, host: GPSD_HOST });
		client = sock;
		let buffer = "";
		let failed = false;

		// error and close both fire for one failed connection; retry only once.
		const lost = (reason: string | null) => {
			if (failed) return;
			failed = true;
			debug.daemon = "offline";
			debug.connectedSince = null;
			debug.devices = [];
			if (reason) debug.lastError = reason;
			debug.reconnects += 1;
			if (!win.isDestroyed()) win.webContents.send("gps-update", { error: true });
			sock.destroy();
			retryTimer = setTimeout(connect, RETRY_MS);
		};

		sock.on("connect", () => {
			debug.daemon = "connected";
			debug.connectedSince = Date.now();
			debug.lastError = null;
		});

		sock.on("data", (chunk) => {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					handleMessage(JSON.parse(line), win, sock);
				} catch {
					// Not valid JSON: ignore the line.
				}
			}
		});

		sock.on("error", (err) => lost(err.message));
		sock.on("close", () => lost("Connection to gpsd closed"));
	};

	win.on("closed", () => { if (retryTimer) clearTimeout(retryTimer); });
	connect();
}
