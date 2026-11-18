import { useEffect, useState } from "react";
import { fetchRouteHazards, type RouteHazard } from "../lib/roadHazards";
import { cumulativeMeters, type Point } from "../lib/routeLocate";

/** Cameras and hazards mapped by the OpenStreetMap community along the route. Fails quietly: no data means no extra alerts. */
export function useRouteHazards(coords: Point[] | undefined, enabled: boolean): RouteHazard[] {
	const [hazards, setHazards] = useState<RouteHazard[]>([]);
	useEffect(() => {
		setHazards([]);
		if (!enabled || !coords || coords.length < 2) return;
		const controller = new AbortController();
		fetchRouteHazards(coords, cumulativeMeters(coords), controller.signal).then(setHazards).catch(() => { /* Offline or busy server. */ });
		return () => controller.abort();
	}, [coords, enabled]);
	return hazards;
}
