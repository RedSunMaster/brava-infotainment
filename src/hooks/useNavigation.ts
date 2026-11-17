import { useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { snapToRoad, NormalizedManeuver } from "../lib/routing";
import type { RoutingProvider } from "../constants";
import { locateOnRoute, routeCache } from "../lib/routeLocate";

const OFF_ROUTE_THRESHOLD_M = 50;
const OFF_ROUTE_COOLDOWN_MS = 8_000;

function haversineMeters(
	[lon1, lat1]: [number, number],
	[lon2, lat2]: [number, number],
): number {
	const R = 6_371_000;
	const φ1 = (lat1 * Math.PI) / 180;
	const φ2 = (lat2 * Math.PI) / 180;
	const Δφ = ((lat2 - lat1) * Math.PI) / 180;
	const Δλ = ((lon2 - lon1) * Math.PI) / 180;
	const a =
		Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findClosestRoutePoint(
	pos: [number, number],
	coords: [number, number][],
): { index: number; distanceM: number } {
	let minDist = Infinity;
	let minIndex = 0;
	let routeDistance = Infinity;
	for (let i = 0; i < coords.length; i++) {
		const d = haversineMeters(pos, coords[i]);
		if (d < minDist) {
			minDist = d;
			minIndex = i;
		}
		const end = coords[i + 1];
		if (!end) continue;
		const start = coords[i];
		const scale = Math.cos(pos[1] * Math.PI / 180);
		const dx = (end[0] - start[0]) * scale;
		const dy = end[1] - start[1];
		const lengthSquared = dx * dx + dy * dy;
		const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
			((pos[0] - start[0]) * scale * dx + (pos[1] - start[1]) * dy) / lengthSquared));
		routeDistance = Math.min(routeDistance, haversineMeters(pos, [
			start[0] + (end[0] - start[0]) * t,
			start[1] + (end[1] - start[1]) * t,
		]));
	}
	return { index: minIndex, distanceM: coords.length > 1 ? routeDistance : minDist };
}

export function useNavigation(
	mapRef: React.RefObject<mapboxgl.Map | null>,
	maneuversRef: React.RefObject<NormalizedManeuver[]>,
	coordsRef: React.RefObject<[number, number][]>,
	simIndexRef: React.RefObject<number>,
	onOffRoute?: () => void,
) {
	const posHistory = useRef<[number, number][]>([]);
	const gpsTrail = useRef<[number, number][]>([]);
	const lastUpdateTime = useRef<number>(Date.now());
	const currentStepRef = useRef(0);
	const lastOffRouteTime = useRef<number>(0);
	// Where on the route the car last was: later searches look near it first, so an out-and-back or looping route cannot jump ahead.
	const lastSegmentRef = useRef(0);
	const distancesFor = useRef(routeCache()).current;

	// Always-fresh ref so the callback never goes stale inside onPositionUpdate
	const onOffRouteRef = useRef(onOffRoute);
	onOffRouteRef.current = onOffRoute;

	const [currentStep, setCurrentStep] = useState(0);
	const [instruction, setInstruction] = useState("Set a destination to begin");
	const [distanceToNextM, setDistanceToNextM] = useState<number | null>(null); // ← new
	const [timeToNextS, setTimeToNextS] = useState<number | null>(null); // ← new

	function smoothPosition(pos: [number, number]): [number, number] {
		posHistory.current.push(pos);
		if (posHistory.current.length > 5) posHistory.current.shift();
		const avg = posHistory.current.reduce(
			(acc, p) => [acc[0] + p[0], acc[1] + p[1]],
			[0, 0],
		);
		return [
			avg[0] / posHistory.current.length,
			avg[1] / posHistory.current.length,
		];
	}

	async function onPositionUpdate(
		rawPos: [number, number],
		_forwardBearing: number,
		speedMs: number,
		provider: RoutingProvider,
		/** Already on the route (estimated while GPS is lost): skip the network map-match. */
		trusted = false,
	) {
		// ✅ Stamp time before the async gap — reflects actual GPS interval
		const now = Date.now();
		lastUpdateTime.current = now;

		// Check raw GPS against segments before network matching can delay or hide a deviation.
		const route = coordsRef.current;
		if (!route.length) return;
		if (speedMs > 1 && findClosestRoutePoint(rawPos, route).distanceM > OFF_ROUTE_THRESHOLD_M) {
			if (now - lastOffRouteTime.current > OFF_ROUTE_COOLDOWN_MS) {
				lastOffRouteTime.current = now;
				onOffRouteRef.current?.();
			}
			return;
		}

		// A trusted position is already exactly on the route, so averaging it with earlier ones would only make it lag.
		gpsTrail.current.push(trusted ? rawPos : smoothPosition(rawPos));
		if (gpsTrail.current.length > 8) gpsTrail.current.shift();

		const snapped = trusted ? gpsTrail.current[gpsTrail.current.length - 1] : await snapToRoad(gpsTrail.current, provider);
		const coords = coordsRef.current;
		if (coords.length === 0 || coords !== route || lastUpdateTime.current !== now) return;

		// Find the closest point on the planned route to the current position.
		// This replaces the old simIndexRef-based check and works for both real
		// GPS and simulation (sim positions are on the route so distanceM ≈ 0,
		// meaning off-route never fires during simulation).
		const cumulative = distancesFor(coords);
		const located = locateOnRoute(coords, cumulative, snapped, lastSegmentRef.current);
		lastSegmentRef.current = located.segment;
		const closestIndex = located.t >= 0.5 ? Math.min(coords.length - 1, located.segment + 1) : located.segment;

		// Advance past every maneuver we have reached first, so the distance and time below
		// describe the maneuver that is now ahead. Measuring first and advancing afterwards
		// published the finished maneuver's 0 m against the next instruction for a moment,
		// which flashed "0 m" on screen and made the voice announce it, then announce it again.
		let step = currentStepRef.current;
		while (maneuversRef.current[step + 1] && closestIndex >= maneuversRef.current[step + 1].begin_shape_index) step++;
		const advanced = step !== currentStepRef.current;
		currentStepRef.current = step;

		// ── Remaining distance + time to next maneuver ────────────────────────────
		const currentManeuver = maneuversRef.current[step];
		const nextManeuver = maneuversRef.current[step + 1];
		const endIndex = nextManeuver?.begin_shape_index ?? coords.length - 1;

		// Measured from the exact spot on the road, not the nearest vertex, so the countdown runs smoothly.
		const remainingM = Math.max(0, cumulative[Math.min(endIndex, coords.length - 1)] - located.along);
		setDistanceToNextM(remainingM);

		// Time estimate: use live speed when moving, fall back to step's avg pace
		if (currentManeuver?.length && currentManeuver?.time) {
			const avgSpeedMs = (currentManeuver.length * 1000) / currentManeuver.time;
			setTimeToNextS(remainingM / Math.max(avgSpeedMs, 1));
		} else {
			setTimeToNextS(null);
		}

		// Keep simIndexRef in sync so trimRoute always trims the right segment.
		simIndexRef.current = closestIndex;

		if (advanced) {
			setCurrentStep(step);
			setInstruction(maneuversRef.current[step]?.instruction ?? "Arrived!");
		}
	}

	function resetNavigation() {
		currentStepRef.current = 0;
		posHistory.current = [];
		gpsTrail.current = [];
		lastOffRouteTime.current = 0;
		lastSegmentRef.current = 0;
		setCurrentStep(0);
		setDistanceToNextM(null); // ← reset
		setTimeToNextS(null); // ← reset
		setInstruction("Set a destination to begin");
	}

	return {
		currentStep,
		instruction,
		setInstruction,
		onPositionUpdate,
		resetNavigation,
		distanceToNextM, // ← new
		timeToNextS, // ← new
	};
}
