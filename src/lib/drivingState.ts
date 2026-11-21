export type DrivingState = "parked" | "moving" | "unknown";
export function nextDrivingState(previous: DrivingState, speedMs: number): DrivingState {
	if (!Number.isFinite(speedMs) || speedMs < 0) return "unknown";
	if (speedMs > 1) return "moving";
	if (speedMs < 0.3) return "parked";
	return previous === "unknown" ? "moving" : previous;
}
/**
 * Whether the controls that need the driver's full attention are locked. They lock while the car is known to be moving, and for the
 * moment a fresh fix has not yet told us the speed. Without GPS at all there is nothing to say the car is moving, so settings, music
 * and the rest stay usable (a car that was last seen moving stays locked until it is seen to stop or GPS comes back).
 */
export function interactionLocked(preview: boolean, hasFix: boolean, state: DrivingState): boolean {
	return state === "moving" || (!preview && hasFix && state === "unknown");
}
