import { useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { snapToRoad, NormalizedManeuver } from "../lib/routing";
import type { RoutingProvider } from "../constants";

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
	for (let i = 0; i < coords.length; i++) {
		const d = haversineMeters(pos, coords[i]);
		if (d < minDist) {
			minDist = d;
			minIndex = i;
		}
	}
	return { index: minIndex, distanceM: minDist };
}

type FollowFn = (
	pos: [number, number],
	bearing: number,
	elapsed: number,
) => void;

function calcRemainingToStep(
	fromIndex: number,
	toIndex: number,
	coords: [number, number][],
): number {
	let dist = 0;
	const end = Math.min(toIndex, coords.length - 1);
	for (let i = fromIndex; i < end; i++) {
		dist += haversineMeters(coords[i], coords[i + 1]);
	}
	return dist;
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
		forwardBearing: number,
		speedMs: number,
		provider: RoutingProvider,
		followPosition: FollowFn,
	) {
		gpsTrail.current.push(smoothPosition(rawPos));
		if (gpsTrail.current.length > 8) gpsTrail.current.shift();

		const snapped = await snapToRoad(gpsTrail.current, provider);
		const bearing = speedMs > 2 ? forwardBearing : mapRef.current!.getBearing();
		const now = Date.now();
		const elapsed = now - lastUpdateTime.current;
		lastUpdateTime.current = now;

		followPosition(snapped, bearing, elapsed);

		const coords = coordsRef.current;
		if (coords.length === 0) return;

		// Find the closest point on the planned route to the current position.
		// This replaces the old simIndexRef-based check and works for both real
		// GPS and simulation (sim positions are on the route so distanceM ≈ 0,
		// meaning off-route never fires during simulation).
		const { index: closestIndex, distanceM } = findClosestRoutePoint(
			snapped,
			coords,
		);

		// ── Remaining distance + time to next maneuver ────────────────────────────
		const currentManeuver = maneuversRef.current[currentStepRef.current];
		const nextManeuver = maneuversRef.current[currentStepRef.current + 1];
		const endIndex = nextManeuver?.begin_shape_index ?? coords.length - 1;

		const remainingM = calcRemainingToStep(closestIndex, endIndex, coords);
		setDistanceToNextM(remainingM);

		// Time estimate: use live speed when moving, fall back to step's avg pace
		if (speedMs > 0.5) {
			setTimeToNextS(remainingM / speedMs);
		} else if (currentManeuver?.length && currentManeuver?.time) {
			const avgSpeedMs = (currentManeuver.length * 1000) / currentManeuver.time;
			setTimeToNextS(remainingM / Math.max(avgSpeedMs, 1));
		} else {
			setTimeToNextS(null);
		}

		// Keep simIndexRef in sync so trimRoute always trims the right segment.
		simIndexRef.current = closestIndex;

		// Off-route — only fire when the vehicle is actually moving.
		if (
			speedMs > 1 &&
			distanceM > OFF_ROUTE_THRESHOLD_M &&
			now - lastOffRouteTime.current > OFF_ROUTE_COOLDOWN_MS
		) {
			lastOffRouteTime.current = now;
			onOffRouteRef.current?.();
			return; // Pause step advancement until the new route arrives
		}

		// Advance to the next maneuver step when the closest route index
		// reaches or passes the next step's start shape index.
		const nextStep = maneuversRef.current[currentStepRef.current + 1];
		if (nextStep && closestIndex >= nextStep.begin_shape_index) {
			currentStepRef.current++;
			setCurrentStep(currentStepRef.current);
			setInstruction(
				maneuversRef.current[currentStepRef.current]?.instruction ?? "Arrived!",
			);
		}
	}

	function resetNavigation() {
		currentStepRef.current = 0;
		posHistory.current = [];
		gpsTrail.current = [];
		lastOffRouteTime.current = 0;
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
