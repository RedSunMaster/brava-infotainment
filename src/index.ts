import { app, BrowserWindow, ipcMain, session, screen } from "electron";
import { createConnection } from "net";

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require("electron-squirrel-startup")) app.quit();

// ── Wayland + Touch flags ─────────────────────────────────────────────────────
app.commandLine.appendSwitch("disable-vulkan");
app.commandLine.appendSwitch("ozone-platform", "wayland");
app.commandLine.appendSwitch("use-angle", "opengles"); // ← replaces use-gl
app.commandLine.appendSwitch("touch-events", "enabled");
app.commandLine.appendSwitch("enable-wayland-ime");
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

const REDIRECT_URI = "myapp://callback";
let mainWindow: BrowserWindow | null = null;

// ── GPS ───────────────────────────────────────────────────────────────────────
function startGps(win: BrowserWindow) {
	const client = createConnection({ port: 2947, host: "localhost" });
	let buffer = "";

	client.on("data", (chunk) => {
		buffer += chunk.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const msg = JSON.parse(line);
				if (msg.class === "VERSION") {
					client.write('?WATCH={"enable":true,"json":true}\n');
					continue;
				}
				if (msg.class === "TPV") {
					win.webContents.send("gps-update", {
						lat: msg.lat ?? null,
						lon: msg.lon ?? null,
						speed: msg.speed ?? 0,
						track: msg.track ?? null,
						mode: msg.mode ?? 0,
					});
				}
			} catch {
				// Do nothing
			}
		}
	});

	client.on("error", () => {
		win.webContents.send("gps-update", { error: true });
		setTimeout(() => startGps(win), 5000);
	});

	app.on("before-quit", () => client.destroy());
}

// ── Main window ───────────────────────────────────────────────────────────────
const createWindow = (): void => {
	const { width, height } = screen.getPrimaryDisplay().workAreaSize;

	mainWindow = new BrowserWindow({
		width,
		height,
		x: 0,
		y: 0,
		frame: true,
		resizable: true,
		show: false,
		webPreferences: {
			zoomFactor: 1,
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

	mainWindow.webContents.once("did-finish-load", () => {
		startGps(mainWindow!);
	});
};

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
app.on("ready", () => {
	createWindow();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
