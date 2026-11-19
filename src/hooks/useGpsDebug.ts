import { useEffect, useState } from "react";
import { ipcRenderer, type IpcRendererEvent } from "electron";
import type { GpsDebugSnapshot } from "../lib/gpsDebug";

/** Live gpsd diagnostics from the main process. Only listens while the GPS settings tab is open. */
export function useGpsDebug(active: boolean) {
	const [snapshot, setSnapshot] = useState<GpsDebugSnapshot | null>(null);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		let cancelled = false;
		const handler = (_e: IpcRendererEvent, data: GpsDebugSnapshot) => setSnapshot({ ...data });
		ipcRenderer.on("gps-debug", handler);
		ipcRenderer.invoke("gps-debug-get").then((data: GpsDebugSnapshot) => { if (!cancelled) setSnapshot({ ...data }); }).catch((): void => undefined);
		// Ages ("2 s ago") keep counting between pushes.
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => { cancelled = true; window.clearInterval(timer); ipcRenderer.removeListener("gps-debug", handler); };
	}, [active]);
	return { snapshot, now };
}
