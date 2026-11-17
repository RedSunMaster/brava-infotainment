import type { Coordinates, LocationResult } from "./locationSearch";

/** Mapbox Matrix allows 10 coordinates: you, the destination and up to 8 candidates. */
export const MAX_DETOUR_CANDIDATES = 8;

/**
 * Extra travel time for each candidate stop, given a durations matrix whose index 0 is
 * your position, 1..n the candidates and n+1 the destination.
 */
export function detourSeconds(matrix: (number | null)[][]): (number | null)[] {
	const last = matrix.length - 1;
	const direct = matrix[0]?.[last];
	return matrix.slice(1, last).map((row, index) => {
		const there = matrix[0][index + 1], onward = row[last];
		return direct == null || there == null || onward == null ? null : Math.max(0, there + onward - direct);
	});
}

export function formatDetour(seconds: number | null | undefined): string {
	if (seconds == null) return "";
	return seconds < 45 ? "On the way" : `+${Math.round(seconds / 60)} min`;
}

export async function fetchStopDetours(position: Coordinates, candidates: Coordinates[], destination: Coordinates, token: string, signal: AbortSignal): Promise<(number | null)[]> {
	const coordinates = [position, ...candidates, destination].map(([lng, lat]) => `${lng},${lat}`).join(";");
	const params = new URLSearchParams({ annotations: "duration", access_token: token });
	const response = await fetch(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving-traffic/${coordinates}?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) });
	if (!response.ok) throw new Error("Detour times unavailable.");
	const data = await response.json();
	if (!Array.isArray(data.durations)) throw new Error("Detour times unavailable.");
	return detourSeconds(data.durations);
}

/** Adds each result's detour and puts the quickest stops first. Falls back to the original order. */
export async function rankByDetour(results: LocationResult[], position: Coordinates, destination: Coordinates, token: string, signal: AbortSignal): Promise<LocationResult[]> {
	const candidates = results.filter(item => item.coords).slice(0, MAX_DETOUR_CANDIDATES);
	if (!candidates.length) return results;
	try {
		const detours = await fetchStopDetours(position, candidates.map(item => item.coords as Coordinates), destination, token, signal);
		return candidates
			.map((item, index) => ({ item: { ...item, detourSeconds: detours[index] }, index }))
			.sort((a, b) => (a.item.detourSeconds ?? Infinity) - (b.item.detourSeconds ?? Infinity) || a.index - b.index)
			.map(entry => entry.item);
	} catch {
		if (signal.aborted) throw new DOMException("Aborted", "AbortError");
		return results;
	}
}
