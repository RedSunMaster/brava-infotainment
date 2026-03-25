import { app, BrowserWindow, ipcMain, session } from "electron";
import { screen } from "electron";
import { spawn, ChildProcess } from "child_process";

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require("electron-squirrel-startup")) app.quit();

// ── Wayland + Touch flags ─────────────────────────────────────────────────────
app.commandLine.appendSwitch("ozone-platform", "wayland");
app.commandLine.appendSwitch("touch-events", "enabled");
app.commandLine.appendSwitch("enable-wayland-ime");
app.commandLine.appendSwitch("disable-vulkan");
app.commandLine.appendSwitch("use-gl", "egl"); // force EGL instead of Vulkan

// ✅ Only ONE enable-features call — combine everything here
app.commandLine.appendSwitch(
	"enable-features",
	"TouchpadOverscrollHistoryNavigation,TouchEventFeatureDetection",
);
app.commandLine.appendSwitch("enable-blink-features", "PointerEvent");

// GPU perf flags
app.commandLine.appendSwitch("enable-accelerated-video-decode");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const REDIRECT_URI = "myapp://callback";
let mainWindow: BrowserWindow | null = null;
let wvkbdProc: ChildProcess | null = null;

// ── Spawn wvkbd hidden on startup ─────────────────────────────────────────────
function spawnKeyboard() {
	try {
		wvkbdProc = spawn("wvkbd-mobintl", ["--hidden", "-L", "280"], {
			env: { ...process.env },
			stdio: "ignore",
			detached: false,
		});
		wvkbdProc.on("error", (e) =>
			console.warn("wvkbd not available:", e.message),
		);
	} catch (e) {
		console.warn("Could not spawn wvkbd:", e);
	}
}

// ── IPC: show / hide keyboard ─────────────────────────────────────────────────
ipcMain.on("keyboard-show", () => wvkbdProc?.kill("SIGUSR2"));
ipcMain.on("keyboard-hide", () => wvkbdProc?.kill("SIGUSR1"));

const createWindow = (): void => {
	const { width, height } = screen.getPrimaryDisplay().workAreaSize;

	mainWindow = new BrowserWindow({
		width,
		height,
		x: 0,
		y: 0,
		frame: false,
		resizable: false,
		show: false,
		webPreferences: {
			zoomFactor: 2,
			preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
			nodeIntegration: true,
			contextIsolation: false,
		},
	});

	mainWindow.show();
	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": [
					"default-src 'self';" +
						"script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:;" +
						"worker-src blob: 'self';" +
						"connect-src 'self' blob: https://*.mapbox.com https://*.tiles.mapbox.com https://* http://localhost:8002;" +
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
		const url = tod
			? `${MAIN_WINDOW_WEBPACK_ENTRY}?tod=${tod}`
			: MAIN_WINDOW_WEBPACK_ENTRY;
		mainWindow!.loadURL(url).catch(() => setTimeout(loadURL, 300));
	};

	loadURL();
};

// ── Spotify auth window (unchanged) ──────────────────────────────────────────
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

app.on("ready", () => {
	spawnKeyboard();
	createWindow();
});

app.on("before-quit", () => {
	wvkbdProc?.kill();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
