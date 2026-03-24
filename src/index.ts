import { app, BrowserWindow, session } from "electron";

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require("electron-squirrel-startup")) {
	app.quit();
}

const createWindow = (): void => {
	const mainWindow = new BrowserWindow({
		height: 1280,
		width: 720,
		webPreferences: {
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
						"connect-src 'self' blob: https://*.mapbox.com https://*.tiles.mapbox.com https://* http://localhost:8002;" + // ✅ add blob:
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
		// ✅ Append as query param if present
		const url = tod
			? `${MAIN_WINDOW_WEBPACK_ENTRY}?tod=${tod}`
			: MAIN_WINDOW_WEBPACK_ENTRY;

		mainWindow.loadURL(url).catch(() => {
			setTimeout(loadURL, 300);
		});
	};

	loadURL();
};
app.commandLine.appendSwitch("enable-accelerated-video-decode");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

app.on("ready", createWindow);

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});
