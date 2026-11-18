import { ipcRenderer } from "electron";

// With contextIsolation: false the preload shares the renderer context,
// so we can assign directly to window.
(window as any).electronSpotify = {
	openAuth: (url: string) => {
		ipcRenderer.send("spotify-open-auth", url);
	},
	onCallback: (
		cb: (payload: { code: string | null; error: string | null }) => void,
	) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			payload: { code: string | null; error: string | null },
		) => cb(payload);

		ipcRenderer.on("spotify-auth-callback", handler);

		return () => ipcRenderer.removeListener("spotify-auth-callback", handler);
	},
};

// ── Self-update (see updaterMain.ts) ─────────────────────────────────────────
(window as any).electronUpdate = {
	getState: () => ipcRenderer.invoke("update:state"),
	apply: () => ipcRenderer.send("update:apply"),
	onState: (cb: (state: unknown) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, state: unknown) => cb(state);
		ipcRenderer.on("update-state", handler);
		return () => ipcRenderer.removeListener("update-state", handler);
	},
};

// ── On-screen keyboard (GNOME/Wayland) ───────────────────────────────────────
(window as any).electronOSK = {
	show: () => ipcRenderer.send("osk-show"),
	hide: () => ipcRenderer.send("osk-hide"),
};
