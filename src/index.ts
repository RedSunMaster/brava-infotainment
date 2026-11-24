import { app, BrowserWindow, components, ipcMain, safeStorage, session, screen } from "electron";
import { chmodSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import {
	configureDisplayPreview,
	getDisplayPreviewGeometry,
	loadDisplayPreview,
} from "./displayPreviewMain";

import { startUpdater } from "./updaterMain";
import { registerAudioIpc } from "./audioMain";
import { startPhoneLink } from "./phoneLinkMain";
import { startGps } from "./gpsMain";
import { registerBluetoothIpc } from "./bluetoothMain";
import { registerExplorationIpc } from "./explorationMain";
import { registerPacmanIpc } from "./pacmanMain";
import { registerDrivesIpc } from "./drivesMain";

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require("electron-squirrel-startup")) app.quit();

// ── Wayland + Touch flags ─────────────────────────────────────────────────────
// On the car computer the desktop logs in by itself, so the system keyring stays locked and asks for a password at every start.
// Chromium's own plain store avoids that; the Spotify token is then kept in a private (0600) file instead.
if (process.platform === "linux") app.commandLine.appendSwitch("password-store", "basic");
app.commandLine.appendSwitch("touch-events", "enabled");
app.commandLine.appendSwitch(
	"enable-features",
	"TouchpadOverscrollHistoryNavigation,TouchEventFeatureDetection",
);
app.commandLine.appendSwitch("enable-blink-features", "PointerEvent");
app.commandLine.appendSwitch("enable-accelerated-video-decode");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

let mainWindow: BrowserWindow | null = null;

function hasArg(name: string) {
	return process.argv.includes(name);
}

// ── Main window ───────────────────────────────────────────────────────────────
const createWindow = (): void => {
	const { width, height } = screen.getPrimaryDisplay().workAreaSize;
	const previewMode = hasArg("--preview");
	const preview = getDisplayPreviewGeometry();

	mainWindow = new BrowserWindow({
		width: previewMode ? preview.width : width,
		height: previewMode ? preview.height : height,
		useContentSize: previewMode,
		x: previewMode ? undefined : 0,
		y: previewMode ? undefined : 0,
		frame: previewMode,
		fullscreen: !previewMode,
		resizable: true,
		show: false,
		title: previewMode ? "Brava Infotainment Preview" : "Brava Infotainment",
		webPreferences: {
			zoomFactor: previewMode ? preview.zoomFactor : 1,
			preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
			nodeIntegration: true,
			contextIsolation: false,
			// Music must be able to start with no tap first (resuming after boot, or started from a phone).
			autoplayPolicy: "no-user-gesture-required",
		},
	});

	configureDisplayPreview(mainWindow, previewMode);

	mainWindow.show();
	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": [
					"default-src 'self';" +
						// cdn.jsdelivr.net serves the ONNX runtime used by the Kokoro voice.
						"script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: https://cdn.jsdelivr.net https://sdk.scdn.co;" +
						"worker-src blob: 'self';" +
						"frame-src https://sdk.scdn.co;" +
						"media-src 'self' blob: data: https://*;" +
						"connect-src 'self' blob: https://*.mapbox.com https://*.tiles.mapbox.com https://* wss://*.spotify.com wss://*.scdn.co http://localhost:8002;" +
						"img-src 'self' data: blob: https://*;" +
						"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;" +
						"font-src 'self' data: https://fonts.gstatic.com;",
				],
			},
		});
	});

	const todArg = process.argv.find((a) => a.startsWith("--tod="));
	const tod = todArg ? todArg.split("=")[1] : null;

	const loadURL = () => {
		const params = new URLSearchParams();
		if (tod) params.set("tod", tod);
		if (previewMode) params.set("preview", "car-portrait");
		const query = params.toString();
		const url = query
			? `${MAIN_WINDOW_WEBPACK_ENTRY}?${query}`
			: MAIN_WINDOW_WEBPACK_ENTRY;
		mainWindow!.loadURL(url).catch(() => setTimeout(loadURL, 300));
	};

	loadURL();

	mainWindow.webContents.once("did-finish-load", () => {
		startGps(mainWindow!);
	});
};

// ── On-screen keyboard (GNOME/Wayland) ───────────────────────────────────────
// Requires GNOME Shell unsafe mode to be enabled. Run once in terminal:
//   gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
//     --method org.gnome.Shell.Eval "global.context.unsafe_mode = true"
ipcMain.on("osk-show", () => {
	exec(
		`gdbus call --session \
      --dest org.gnome.Shell \
      --object-path /org/gnome/Shell \
      --method org.gnome.Shell.Eval \
      "imports.ui.main.keyboard.show(0)"`,
		(err) => {
			if (err) console.warn("[OSK] show failed:", err.message);
		},
	);
});

ipcMain.on("osk-hide", () => {
	exec(
		`gdbus call --session \
      --dest org.gnome.Shell \
      --object-path /org/gnome/Shell \
      --method org.gnome.Shell.Eval \
      "imports.ui.main.keyboard.hide()"`,
		(err) => {
			if (err) console.warn("[OSK] hide failed:", err.message);
		},
	);
});

startUpdater(() => mainWindow);
registerAudioIpc();
startPhoneLink(() => mainWindow);
registerBluetoothIpc();
registerExplorationIpc();
registerPacmanIpc();
registerDrivesIpc();

// ── App lifecycle (quit via renderer) ────────────────────────────────────────
ipcMain.on("app-quit", () => app.quit());

// ── Boot splash hand-over ─────────────────────────────────────────────────────
// The early boot splash (deploy/boot) stays up until the app's own opening screen, which looks the same, is on the display; it
// watches for this file.
ipcMain.on("splash-shown", () => {
	try {
		const dir = process.env.XDG_RUNTIME_DIR;
		if (dir) writeFileSync(join(dir, "brava-ready"), String(Date.now()));
	} catch { /* Not on the car computer. */ }
});

// ── Spotify refresh token ─────────────────────────────────────────────────────
// Kept in a file in the app's data folder, encrypted with the system keyring when there is one, so
// Spotify stays connected across restarts without signing in again.
const spotifyTokenFile = () => join(app.getPath("userData"), "spotify-refresh-token");
ipcMain.handle("spotify-refresh-get", () => {
	try {
		const file = spotifyTokenFile();
		if (!existsSync(file)) return null;
		const raw = readFileSync(file);
		const encrypted = raw[0] === 1;
		const body = raw.subarray(1);
		return encrypted ? (safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(body) : null) : body.toString("utf8");
	} catch (error) {
		console.warn("[Spotify] could not read the saved token:", error);
		return null;
	}
});
ipcMain.handle("spotify-refresh-set", (_event, token: string | null) => {
	try {
		const file = spotifyTokenFile();
		if (!token) {
			if (existsSync(file)) unlinkSync(file);
			return;
		}
		const encrypted = safeStorage.isEncryptionAvailable();
		const body = encrypted ? safeStorage.encryptString(token) : Buffer.from(token, "utf8");
		// Write a temp file, flush it to disk, then swap it in: the car can lose power at any moment, and a
		// half-written file would mean signing in again.
		const tmp = `${file}.tmp`;
		const fd = openSync(tmp, "w", 0o600);
		try {
			writeSync(fd, Buffer.concat([Buffer.from([encrypted ? 1 : 0]), body]));
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(tmp, file);
		try { chmodSync(file, 0o600); } catch { /* Not supported everywhere. */ }
	} catch (error) {
		console.warn("[Spotify] could not save the token:", error);
	}
});

// ── Spotify auth ──────────────────────────────────────────────────────────────
ipcMain.on("spotify-open-auth", (_event, authUrl: string) => {
	const authWindow = new BrowserWindow({
		width: 500,
		height: 750,
		title: "Connect Spotify",
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			partition: "persist:spotify-auth",
		},
	});

	authWindow.setMenuBarVisibility(false);
	authWindow.webContents.setUserAgent(
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
			"AppleWebKit/537.36 (KHTML, like Gecko) " +
			"Chrome/122.0.0.0 Safari/537.36",
	);

	authWindow.loadURL(authUrl);
	authWindow.webContents.on("will-navigate", (_e, url) =>
		handleAuthRedirect(url, authWindow),
	);
	authWindow.webContents.on("will-redirect", (_e, url) =>
		handleAuthRedirect(url, authWindow),
	);
	authWindow.on("closed", () => {
		mainWindow?.webContents.send("spotify-auth-callback", {
			code: null,
			error: "window_closed",
		});
	});
});

function handleAuthRedirect(url: string, authWindow: BrowserWindow) {
	if (!url.startsWith("myapp://callback")) return;
	authWindow.webContents.stop();
	authWindow.close();
	try {
		const parsed = new URL(url);
		mainWindow?.webContents.send("spotify-auth-callback", {
			code: parsed.searchParams.get("code"),
			error: parsed.searchParams.get("error"),
		});
	} catch (e) {
		console.error("Failed to parse Spotify callback URL:", e);
		mainWindow?.webContents.send("spotify-auth-callback", {
			code: null,
			error: "parse_error",
		});
	}
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.on("ready", async () => {
	// Widevine (castlabs Electron) must be registered before the Spotify Web Playback SDK can play.
	await components.whenReady().catch((e: unknown) => console.error("Widevine not ready:", e));
	await loadDisplayPreview();
	createWindow();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
