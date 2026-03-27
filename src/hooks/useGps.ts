import { useEffect, useRef, useState } from "react";

export type GpsStatus = "fix" | "no-fix" | "disconnected";

export function useGps(
	onUpdate: (pos: [number, number], bearing: number, speed: number) => void,
) {
	const [status, setStatus] = useState<GpsStatus>("disconnected");
	const onUpdateRef = useRef(onUpdate);
	onUpdateRef.current = onUpdate;

	useEffect(() => {
		// nodeIntegration: true — require works directly
		const { ipcRenderer } = window.require("electron");

		const handler = (_event: any, data: any) => {
			if (data.error || data.mode === undefined) {
				setStatus("disconnected");
				return;
			}
			if (data.mode < 2 || data.lat == null) {
				setStatus("no-fix");
				return;
			}
			setStatus("fix");
			const pos: [number, number] = [data.lon, data.lat];
			onUpdateRef.current(pos, data.track ?? 0, data.speed ?? 0);
		};

		ipcRenderer.on("gps-update", handler);
		return () => ipcRenderer.removeListener("gps-update", handler);
	}, []);

	return { status };
}
