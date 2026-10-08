export type DrivingState = "parked" | "moving" | "unknown";
export function nextDrivingState(previous: DrivingState, speedMs: number): DrivingState {
	if (!Number.isFinite(speedMs) || speedMs < 0) return "unknown";
	if (speedMs > 1) return "moving";
	if (speedMs < 0.3) return "parked";
	return previous === "unknown" ? "moving" : previous;
}
export function interactionLocked(preview: boolean, hasFix: boolean, state: DrivingState): boolean {
	return state === "moving" || (!preview && (!hasFix || state === "unknown"));
}
