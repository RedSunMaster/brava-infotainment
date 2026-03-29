import { useRef, useState } from "react";
import { calcBearing } from "../lib/geo";
import type { RoutingProvider } from "../constants";

const SIM_SPEED_MS = 14; // ~50 km/h

type UpdateFn = (
	pos: [number, number],
	bearing: number,
	speed: number,
	provider: RoutingProvider,
) => Promise<void>;

function haversineMeters(
	[lon1, lat1]: [number, number],
	[lon2, lat2]: [number, number],
): number {
	const R = 6_371_000;
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLon = ((lon2 - lon1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) *
			Math.cos((lat2 * Math.PI) / 180) *
			Math.sin(dLon / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function totalRouteLength(coords: [number, number][]): number {
	let total = 0;
	for (let i = 0; i < coords.length - 1; i++)
		total += haversineMeters(coords[i], coords[i + 1]);
	return total;
}

function positionAlongRoute(
	coords: [number, number][],
	distanceM: number,
): [number, number] {
	let remaining = Math.max(0, distanceM);
	for (let i = 0; i < coords.length - 1; i++) {
		const segLen = haversineMeters(coords[i], coords[i + 1]);
		if (remaining <= segLen) {
			const t = segLen > 0 ? remaining / segLen : 0;
			return [
				coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
				coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
			];
		}
		remaining -= segLen;
	}
	return coords[coords.length - 1];
}

function bearingAlongRoute(
	coords: [number, number][],
	distanceM: number,
): number {
	if (coords.length < 2) return 0;
	let remaining = Math.max(0, distanceM);
	let segIdx = 0;
	for (let i = 0; i < coords.length - 1; i++) {
		const segLen = haversineMeters(coords[i], coords[i + 1]);
		if (remaining <= segLen) {
			segIdx = i;
			break;
		}
		remaining -= segLen;
		segIdx = i + 1;
	}
	const i = Math.min(segIdx, coords.length - 2);
	return calcBearing(coords[i], coords[i + 1]);
}

// Nearest vertex index to a given distance along route — used for trimRoute
function vertexIndexAtDistance(
	coords: [number, number][],
	distanceM: number,
): number {
	let remaining = Math.max(0, distanceM);
	for (let i = 0; i < coords.length - 1; i++) {
		const segLen = haversineMeters(coords[i], coords[i + 1]);
		if (remaining <= segLen) return i;
		remaining -= segLen;
	}
	return coords.length - 1;
}

export function useSimulation(
	coordsRef: React.RefObject<[number, number][]>,
	simIndexRef: React.RefObject<number>,
	onPositionUpdate: UpdateFn,
	setInstruction: (s: string) => void,
) {
	const rafRef = useRef<number | null>(null);
	const distanceCursorRef = useRef<number>(0);
	const lastFrameTimeRef = useRef<number>(0);
	const lastNavTickRef = useRef<number>(0); // throttle onPositionUpdate to ~1Hz
	const providerRef = useRef<RoutingProvider>("mapbox");
	const [simRunning, setSimRunning] = useState(false);

	function startSimulation(provider: RoutingProvider) {
		if (rafRef.current) cancelAnimationFrame(rafRef.current);
		providerRef.current = provider;
		distanceCursorRef.current = 0;
		simIndexRef.current = 0;
		lastNavTickRef.current = 0;
		setSimRunning(true);

		lastFrameTimeRef.current = performance.now();

		function tick(now: number) {
			const coords = coordsRef.current;

			if (!coords.length) {
				rafRef.current = requestAnimationFrame(tick);
				return;
			}

			const dt = Math.min((now - lastFrameTimeRef.current) / 1000, 0.1);
			lastFrameTimeRef.current = now;

			distanceCursorRef.current += SIM_SPEED_MS * dt;

			const routeLen = totalRouteLength(coords);

			// ── Arrived ──────────────────────────────────────────────────────────
			if (distanceCursorRef.current >= routeLen) {
				const endPos = coords[coords.length - 1];
				simIndexRef.current = coords.length - 1;
				onPositionUpdate(endPos, 0, 0, providerRef.current);
				setInstruction("Arrived!");
				setSimRunning(false);
				return; // intentionally don't re-queue rAF
			}

			// ── Per-frame: move vertex index + trim route line ────────────────────
			const vertexIdx = vertexIndexAtDistance(
				coords,
				distanceCursorRef.current,
			);
			simIndexRef.current = vertexIdx;

			// ── ~1 Hz: fire onPositionUpdate for step detection + puck correction ─
			// onPositionUpdate → trackedPositionUpdate → updatePuck corrects the
			// puck's own distance cursor. Between ticks the puck advances at the
			// last-known speed (SIM_SPEED_MS), so motion is always continuous.
			if (now - lastNavTickRef.current >= 1000) {
				lastNavTickRef.current = now;
				const pos = positionAlongRoute(coords, distanceCursorRef.current);
				const bearing = bearingAlongRoute(coords, distanceCursorRef.current);
				onPositionUpdate(pos, bearing, SIM_SPEED_MS, providerRef.current);
			}

			rafRef.current = requestAnimationFrame(tick);
		}

		rafRef.current = requestAnimationFrame(tick);
	}

	function stopSimulation() {
		if (rafRef.current) cancelAnimationFrame(rafRef.current);
		rafRef.current = null;
		setSimRunning(false);
	}

	return { simRunning, startSimulation, stopSimulation };
}
