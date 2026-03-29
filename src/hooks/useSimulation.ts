import { useRef, useState } from "react";
import { calcBearing } from "../lib/geo";
import type { RoutingProvider } from "../constants";

type FollowFn = (
	pos: [number, number],
	bearing: number,
	elapsed: number,
) => void;
type UpdateFn = (
	pos: [number, number],
	bearing: number,
	speed: number,
	provider: RoutingProvider,
	followPosition: FollowFn,
) => Promise<void>;

export function useSimulation(
	coordsRef: React.RefObject<[number, number][]>,
	simIndexRef: React.RefObject<number>,
	onPositionUpdate: UpdateFn,
	trimRoute: (fromIndex: number) => void,
	setInstruction: (s: string) => void,
	followPosition: FollowFn,
) {
	const simInterval = useRef<ReturnType<typeof setInterval> | null>(null);
	const [simRunning, setSimRunning] = useState(false);

	function startSimulation(provider: RoutingProvider) {
		if (simInterval.current) clearInterval(simInterval.current);
		simIndexRef.current = 0;
		setSimRunning(true);

		simInterval.current = setInterval(async () => {
			const coords = coordsRef.current;
			const i = simIndexRef.current;

			if (i >= coords.length) {
				clearInterval(simInterval.current!);
				setSimRunning(false);
				setInstruction("Arrived!");
				return;
			}

			const pos = coords[i];
			const next = coords[i + 1] ?? coords[i];
			const bearing = calcBearing(pos, next);

			await onPositionUpdate(pos, bearing, 14, provider, followPosition);
			simIndexRef.current++;
			// Trim synchronously after advancing the index so the remaining-route
			// line stays in lock-step with the simulated position.
			trimRoute(simIndexRef.current);
		}, 250);
	}

	function stopSimulation() {
		if (simInterval.current) clearInterval(simInterval.current);
		setSimRunning(false);
	}

	return { simRunning, startSimulation, stopSimulation };
}
