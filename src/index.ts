import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { screen } from "electron";

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require("electron-squirrel-startup")) {
	app.quit();
}

const REDIRECT_URI = "myapp://callback"; // still used as the sentinel URL to intercept

let mainWindow: BrowserWindow | null = null;

const createWindow = (): void => {
	const { height } = screen.getPrimaryDisplay().workAreaSize;
	const zoomFactor = height >= 1920 ? 1.5 : 1.0;

	mainWindow = new BrowserWindow({
		height: 1920,
		width: 1080,
		webPreferences: {
			zoomFactor: 2,
			preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
			nodeIntegration: true,
			contextIsolation: false,
		},
	});

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

// ── IPC: open Spotify auth in a controlled child BrowserWindow ────────────────
// This avoids shell.openExternal + custom protocol issues on Linux/Wayland.
// The child window handles Facebook/Google sub-logins naturally, and we
// intercept the myapp://callback redirect before it hits the OS.
ipcMain.on("spotify-open-auth", (_event, authUrl: string) => {
	// Use a dedicated partition so this window gets its own session,
	// completely separate from the main window's CSP overrides
	const authWindow = new BrowserWindow({
		width: 500,
		height: 750,
		title: "Connect Spotify",
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			partition: "persist:spotify-auth", // ← isolated session, no CSP override
		},
	});

	authWindow.setMenuBarVisibility(false);

	// Ensure Facebook/Google sub-logins render correctly by setting
	// a standard Chrome user agent — Electron's UA can cause fallback layouts
	authWindow.webContents.setUserAgent(
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
			"AppleWebKit/537.36 (KHTML, like Gecko) " +
			"Chrome/122.0.0.0 Safari/537.36",
	);

	authWindow.loadURL(authUrl);

	authWindow.webContents.on("will-navigate", (_e, url) => {
		handleAuthRedirect(url, authWindow);
	});

	authWindow.webContents.on("will-redirect", (_e, url) => {
		handleAuthRedirect(url, authWindow);
	});

	authWindow.on("closed", () => {
		mainWindow?.webContents.send("spotify-auth-callback", {
			code: null,
			error: "window_closed",
		});
	});
});

function handleAuthRedirect(url: string, authWindow: BrowserWindow) {
	if (!url.startsWith("myapp://callback")) return;

	// Prevent the window from actually trying to load the custom URI
	authWindow.webContents.stop();
	authWindow.close();

	try {
		const parsed = new URL(url);
		const code = parsed.searchParams.get("code");
		const error = parsed.searchParams.get("error");
		mainWindow?.webContents.send("spotify-auth-callback", { code, error });
	} catch (e) {
		console.error("Failed to parse Spotify callback URL:", e);
		mainWindow?.webContents.send("spotify-auth-callback", {
			code: null,
			error: "parse_error",
		});
	}
}

app.commandLine.appendSwitch("enable-accelerated-video-decode");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("ozone-platform", "wayland");
app.commandLine.appendSwitch("touch-events", "enabled");
app.commandLine.appendSwitch(
	"enable-features",
	"UseOzonePlatform,VirtualKeyboard",
);
app.commandLine.appendSwitch("enable-wayland-ime");

app.on("ready", () => {
	createWindow();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
