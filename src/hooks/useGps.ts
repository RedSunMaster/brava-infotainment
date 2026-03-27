import { useEffect, useRef, useState } from "react";

export type GpsStatus = "fix" | "no-fix" | "disconnected";

export function useGps(
	onUpdate: (pos: [number, number], bearing: number, speed: number) => void,
) {
	const [status, setStatus] = useState<GpsStatus>("disconnected");
	const onUpdateRef = useRef(onUpdate);
	onUpdateRef.current = onUpdate;

	useEffect(() => {
		const es = new EventSource("/api/gps");

		es.onmessage = (e) => {
			const data = JSON.parse(e.data);

			if (data.error || data.mode === undefined) {
				setStatus("disconnected");
				return;
			}
			if (data.mode < 2 || data.lat == null) {
				setStatus("no-fix");
				return;
			}

			setStatus("fix");
			const pos: [number, number] = [data.lon, data.lat]; // Mapbox is [lng, lat]
			onUpdateRef.current(pos, data.track ?? 0, data.speed ?? 0);
		};

		es.onerror = () => setStatus("disconnected");
		return () => es.close();
	}, []);

	return { status };
}
