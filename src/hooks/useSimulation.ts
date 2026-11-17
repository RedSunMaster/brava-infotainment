import { useRef, useState } from "react";
import type { RoutingProvider } from "../constants";
import type { NormalizedRoute } from "../lib/routing";
import { buildProfile, drive, type Profile } from "../lib/simulationProfile";

/** How often the simulated "GPS receiver" reports. Faster than a real receiver, so the guidance never skips a point. */
const REPORT_MS = 250;
/** A stalled frame (a hidden window, a long pause) must not teleport the car along the route. */
const MAX_FRAME_S = 0.1;

type UpdateFn = (
	pos: [number, number],
	bearing: number,
	speed: number,
	provider: RoutingProvider,
	/** The position is exactly on the route, so no map-matching or smoothing is needed. */
	trusted?: boolean,
) => Promise<void>;

/**
 * Drives the active route like a person would: the posted speed limit (slower in traffic, round
 * bends and junctions, and into roundabouts), smooth braking and acceleration, and a stop at the
 * end. When the route changes mid-drive (a reroute or a faster route) it plans the new route from
 * the speed the car already has.
 */
export function useSimulation(
	coordsRef: React.RefObject<[number, number][]>,
	routeRef: React.RefObject<NormalizedRoute | null>,
	onPositionUpdate: UpdateFn,
	setInstruction: (s: string) => void,
) {
	const rafRef = useRef<number | null>(null);
	const providerRef = useRef<RoutingProvider>("mapbox");
	const [simRunning, setSimRunning] = useState(false);

	function startSimulation(provider: RoutingProvider) {
		if (rafRef.current) cancelAnimationFrame(rafRef.current);
		providerRef.current = provider;
		setSimRunning(true);

		let profile: Profile | null = null;
		let travelled = 0;
		let speed = 0;
		let lastFrame = performance.now();
		let lastReport = 0;

		function tick(now: number) {
			const coords = coordsRef.current;
			const route = routeRef.current;
			// Wait until the route being driven is the one the app has drawn and is guiding along.
			if (!coords.length || !route || route.coords !== coords) {
				lastFrame = now;
				rafRef.current = requestAnimationFrame(tick);
				return;
			}
			if (!profile || profile.coords !== coords) {
				profile = buildProfile(route, speed);
				travelled = 0;
				lastReport = 0;
			}

			const seconds = Math.min((now - lastFrame) / 1000, MAX_FRAME_S);
			lastFrame = now;
			const step = drive(profile, travelled, seconds);
			travelled = step.distance;
			const { state } = step;
			speed = state.speed;

			if (state.arrived) {
				void onPositionUpdate(state.pos, state.bearing, 0, providerRef.current, true);
				setInstruction("Arrived!");
				setSimRunning(false);
				rafRef.current = null;
				return; // Not re-queued: the drive is over.
			}

			if (now - lastReport >= REPORT_MS) {
				lastReport = now;
				void onPositionUpdate(state.pos, state.bearing, state.speed, providerRef.current, true);
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
