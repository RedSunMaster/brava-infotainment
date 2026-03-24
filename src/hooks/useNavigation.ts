import { useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { snapToRoad, NormalizedManeuver } from "../lib/routing";
import type { RoutingProvider } from "../constants";

export function useNavigation(
	mapRef: React.RefObject<mapboxgl.Map | null>,
	maneuversRef: React.RefObject<NormalizedManeuver[]>,
	simIndexRef: React.RefObject<number>,
) {
	const posHistory = useRef<[number, number][]>([]);
	const gpsTrail = useRef<[number, number][]>([]);
	const lastUpdateTime = useRef<number>(Date.now());
	const currentStepRef = useRef(0);

	const [currentStep, setCurrentStep] = useState(0);
	const [instruction, setInstruction] = useState("Set a destination to begin");

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
		followPosition: (
			pos: [number, number],
			bearing: number,
			elapsed: number,
		) => void,
	) {
		gpsTrail.current.push(smoothPosition(rawPos));
		if (gpsTrail.current.length > 8) gpsTrail.current.shift();

		const snapped = await snapToRoad(gpsTrail.current, provider);
		const bearing = speedMs > 2 ? forwardBearing : mapRef.current!.getBearing();
		const now = Date.now();
		const elapsed = now - lastUpdateTime.current;
		lastUpdateTime.current = now;

		followPosition(snapped, bearing, elapsed);

		const nextStep = maneuversRef.current[currentStepRef.current + 1];
		if (nextStep && simIndexRef.current >= nextStep.begin_shape_index) {
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
		setCurrentStep(0);
		setInstruction("Set a destination to begin");
	}

	return {
		currentStep,
		instruction,
		setInstruction,
		onPositionUpdate,
		resetNavigation,
	};
}
