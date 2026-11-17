import { useEffect, useRef, useState } from "react";
import { advanceAlongRoute, estimatedDistance, type LastFix, type Point } from "../lib/deadReckoning";

/**
 * Keeps the car moving along the route when GPS drops out (tunnels, car parks): once no fix has
 * arrived for a few seconds, position is advanced along the route at the last known speed.
 * Returns true while the position is an estimate. Every estimate is measured from the last real
 * fix, so errors do not build up, and a real fix takes over the moment it returns.
 */
export function useDeadReckoning(
	enabled: boolean,
	coordsRef: React.RefObject<Point[]>,
	lastFixRef: React.RefObject<LastFix | null>,
	onEstimate: (pos: Point, bearing: number, speed: number) => void,
): boolean {
	const [estimating, setEstimating] = useState(false);
	const callback = useRef(onEstimate);
	callback.current = onEstimate;

	useEffect(() => {
		if (!enabled) { setEstimating(false); return; }
		const tick = () => {
			const fix = lastFixRef.current;
			const distance = estimatedDistance(Date.now(), fix);
			const coords = coordsRef.current;
			const estimate = fix && distance != null && coords.length >= 2 ? advanceAlongRoute(coords, fix.pos, distance) : null;
			if (!fix || !estimate || estimate.atEnd) { setEstimating(false); return; }
			setEstimating(true);
			callback.current(estimate.pos, estimate.bearing, fix.speed);
		};
		const timer = window.setInterval(tick, 1000);
		return () => { window.clearInterval(timer); setEstimating(false); };
	}, [enabled, coordsRef, lastFixRef]);

	return estimating;
}
