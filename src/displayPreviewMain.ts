import { app, BrowserWindow, ipcMain, Menu, screen } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
	DEFAULT_DISPLAY_PREVIEW,
	previewGeometry,
	validateDisplayPreview,
	type DisplayPreviewSettings,
	type DisplayPreviewState,
} from "./displayPreview";

let settings: DisplayPreviewSettings = { ...DEFAULT_DISPLAY_PREVIEW };
let applyingWindowSize = false;
const settingsPath = () =>
	path.join(app.getPath("userData"), "display-preview.json");

export async function loadDisplayPreview(): Promise<void> {
	try {
		const saved: DisplayPreviewSettings = JSON.parse(
			await readFile(settingsPath(), "utf8"),
		);
		if (!validateDisplayPreview(saved)) settings = saved;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return;
		console.warn("Could not restore display preview settings:", error);
	}
}

export function getDisplayPreviewGeometry() {
	const desktop = screen.getPrimaryDisplay();
	return previewGeometry(settings, {
		...desktop.workAreaSize,
		scaleFactor: desktop.scaleFactor,
	});
}

function applyWindowPreview(win: BrowserWindow, resize: boolean): void {
	if (applyingWindowSize) return;
	applyingWindowSize = true;
	try {
		if (resize && !win.isFullScreen()) {
			if (win.isMaximized()) win.unmaximize();
			const desktop = screen.getDisplayMatching(win.getBounds());
			const geometry = previewGeometry(settings, {
				...desktop.workAreaSize,
				scaleFactor: desktop.scaleFactor,
			});
			win.setAspectRatio(0);
			win.setResizable(settings.sizeMode === "fit");
			win.setMaximizable(settings.sizeMode === "fit");
			win.setContentSize(geometry.width, geometry.height);
			win.center();
		}
		const [width] = win.getContentSize();
		win.webContents.setZoomFactor((width * settings.uiScale) / settings.width);
		win.setTitle(
			`Brava Preview — ${settings.width} × ${settings.height} · ${settings.ppi} PPI · ${Math.round(settings.uiScale * 100)}%`,
		);
		const [outerWidth, outerHeight] = win.getSize();
		const [contentWidth, contentHeight] = win.getContentSize();
		win.setAspectRatio(win.isFullScreen() ? 0 : settings.width / settings.height, {
			width: outerWidth - contentWidth,
			height: outerHeight - contentHeight,
		});
	} finally {
		applyingWindowSize = false;
	}
}

export function configureDisplayPreview(
	win: BrowserWindow,
	enabled: boolean,
): void {
	const state = (): DisplayPreviewState => ({
		enabled,
		settings: { ...settings },
	});
	ipcMain.removeHandler("display-preview:get");
	ipcMain.removeHandler("display-preview:apply");
	ipcMain.handle("display-preview:get", (event) => {
		if (event.sender !== win.webContents)
			throw new Error("Unsupported display settings window.");
		return state();
	});
	ipcMain.handle(
		"display-preview:apply",
		async (event, next: DisplayPreviewSettings) => {
			if (!enabled || event.sender !== win.webContents)
				throw new Error("Display simulation is available in preview mode.");
			const error = validateDisplayPreview(next);
			if (error) throw new Error(error);
			const previous = settings;
			const desktop = screen.getDisplayMatching(win.getBounds());
			const expected = previewGeometry(next, {
				...desktop.workAreaSize,
				scaleFactor: desktop.scaleFactor,
			});
			settings = { ...next };
			try {
				applyWindowPreview(win, true);
				await new Promise<void>((resolve) => setTimeout(resolve, 150));
				const [width, height] = win.getContentSize();
				if (
					Math.abs(width - expected.width) > 2 ||
					Math.abs(height - expected.height) > 2
				) {
					console.warn("Display preview size mismatch", {
						expected,
						actual: { width, height },
						desktop,
						bounds: win.getBounds(),
					});
					throw new Error(
						"Your desktop cannot display this window size. Choose Fit full monitor to desktop.",
					);
				}
				await mkdir(app.getPath("userData"), { recursive: true });
				await writeFile(settingsPath(), JSON.stringify(next, null, 2), "utf8");
			} catch (cause) {
				settings = previous;
				applyWindowPreview(win, true);
				throw cause;
			}
			return state();
		},
	);
	if (!enabled) return;
	win.setMenuBarVisibility(false);
	const fullscreenOn = (displayId: number) => {
		const display = screen.getAllDisplays().find((item) => item.id === displayId);
		if (!display) return;
		win.setFullScreen(false);
		win.setAspectRatio(0);
		win.setResizable(true);
		win.setMaximizable(true);
		win.setBounds(display.bounds);
		win.setMenuBarVisibility(false);
		win.setFullScreen(true);
		win.focus();
	};
	console.info("Preview displays", screen.getAllDisplays().map(({ id, label, bounds, scaleFactor }) => ({ id, label, bounds, scaleFactor })));
	win.on("leave-full-screen", () => {
		win.setMenuBarVisibility(true);
		applyWindowPreview(win, true);
	});
	const menu = Menu.buildFromTemplate([
		{
			label: "Display",
			submenu: [
				{
					label: "Resolution and PPI…",
					accelerator: "CmdOrCtrl+Shift+D",
					click: () => win.webContents.send("display-preview:open"),
				},
				{
					label: "Fullscreen on this monitor",
					accelerator: "F11",
					click: () => win.isFullScreen() ? win.setFullScreen(false) : fullscreenOn(screen.getDisplayMatching(win.getBounds()).id),
				},
				{
					label: "Fullscreen on connected monitor",
					accelerator: "CmdOrCtrl+Shift+F",
					click: () => {
						const displays = screen.getAllDisplays();
						const target = displays.find((item) => /verbatim/i.test(item.label)) ?? displays.find((item) => item.id !== screen.getPrimaryDisplay().id && item.bounds.width < item.bounds.height) ?? displays.find((item) => item.id !== screen.getPrimaryDisplay().id) ?? screen.getPrimaryDisplay();
						fullscreenOn(target.id);
					},
				},
				{
					label: "Choose fullscreen monitor",
					submenu: screen.getAllDisplays().map((display) => ({
						label: `${display.label || "Monitor"} — ${display.bounds.width} × ${display.bounds.height}`,
						click: () => fullscreenOn(display.id),
					})),
				},
				{ type: "separator" },
				{ role: "close" },
			],
		},
		{ role: "editMenu" },
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
			],
		},
	]);
	win.setMenu(menu);
	win.setMenuBarVisibility(true);
	win.on("resize", () => applyWindowPreview(win, false));
	let displayId = screen.getDisplayMatching(win.getBounds()).id;
	win.on("moved", () => {
		const nextDisplayId = screen.getDisplayMatching(win.getBounds()).id;
		if (nextDisplayId !== displayId) {
			displayId = nextDisplayId;
			applyWindowPreview(win, settings.sizeMode !== "fit");
		}
	});
	win.webContents.on("did-finish-load", () => applyWindowPreview(win, false));
	applyWindowPreview(win, true);
}
