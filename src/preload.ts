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

// ── On-screen keyboard (GNOME/Wayland) ───────────────────────────────────────
(window as any).electronOSK = {
	show: () => ipcRenderer.send("osk-show"),
	hide: () => ipcRenderer.send("osk-hide"),
};
