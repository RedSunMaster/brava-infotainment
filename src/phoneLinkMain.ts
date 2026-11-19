import { ipcMain, type BrowserWindow } from "electron";
import { chmodSync, existsSync, unlinkSync } from "fs";
import { createServer, type Socket } from "net";
import { join } from "path";
import { tmpdir } from "os";
import { createLineSplitter, frame, parsePhoneMessage, type CarMessage } from "./lib/phoneLink";

/**
 * Receives notifications from the Brava Phone Link Android app and passes them to the screen.
 *
 * The phone connects to us (we only listen), over one of:
 *  - Bluetooth: deploy/phone/phone-bridge.py takes the phone's RFCOMM connection from BlueZ and passes it to a unix socket in the
 *    user's runtime directory (mode 0600, so only this user's programs can use it). The real link in the car;
 *  - TCP on 127.0.0.1, only when BRAVA_PHONE_TCP_PORT is set: for development, with the emulator reaching it through
 *    `adb reverse`. It is never on in a normal run, and listens on the loopback address only.
 */
export interface PhoneLinkState { connected: boolean; device: string | null; transport: "tcp" | "bluetooth" | null; lastSeen: number | null }

export function startPhoneLink(getWindow: () => BrowserWindow | null): void {
	let state: PhoneLinkState = { connected: false, device: null, transport: null, lastSeen: null };
	let active: Socket | null = null;

	const send = (channel: string, payload: unknown) => {
		const window = getWindow();
		if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
	};
	const setState = (next: Partial<PhoneLinkState>) => { state = { ...state, ...next }; send("phone:state", state); };
	const write = (message: CarMessage) => { if (active && !active.destroyed) active.write(frame(message)); };

	ipcMain.handle("phone:state", () => state);
	ipcMain.on("phone:dismiss", (_event, key: unknown) => { if (typeof key === "string" && key.length <= 300) write({ t: "dismiss", key }); });

	function accept(socket: Socket, transport: "tcp" | "bluetooth") {
		// One phone at a time: a newer connection replaces an older one (the phone reconnecting after a drop).
		if (active && active !== socket) active.destroy();
		active = socket;
		socket.setEncoding("utf8");
		setState({ connected: true, transport, lastSeen: Date.now() });
		const feed = createLineSplitter((line) => {
			const message = parsePhoneMessage(line);
			if (!message) return;
			state = { ...state, lastSeen: Date.now() };
			if (message.t === "hello") setState({ device: message.device });
			else if (message.t === "ping") write({ t: "pong" });
			else send("phone:message", message);
		});
		socket.on("data", feed);
		socket.on("error", () => socket.destroy());
		socket.on("close", () => { if (active === socket) { active = null; setState({ connected: false }); } });
	}

	if (process.platform === "linux") {
		const path = join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), "brava-phone.sock");
		try { if (existsSync(path)) unlinkSync(path); } catch { /* A stale socket from a crash; listen() reports it if it cannot be replaced. */ }
		createServer((socket) => accept(socket, "bluetooth"))
			.on("error", (error) => console.warn("[phone] bridge socket failed:", error.message))
			.listen(path, () => { try { chmodSync(path, 0o600); } catch { /* Not fatal: the runtime directory is already private. */ } console.info(`[phone] waiting for the Bluetooth bridge at ${path}`); });
	}

	const port = Number(process.env.BRAVA_PHONE_TCP_PORT);
	if (Number.isInteger(port) && port > 0 && port < 65536) {
		createServer((socket) => accept(socket, "tcp")).on("error", (error) => console.warn("[phone] TCP link failed:", error.message)).listen(port, "127.0.0.1", () => console.info(`[phone] development link listening on 127.0.0.1:${port}`));
	}
}
