import type { NormalizedManeuver } from "./routing";
export function remainingTrip(maneuvers: NormalizedManeuver[], currentStep: number, remainingMeters?: number | null, remainingSeconds?: number | null) {
 const current = maneuvers[currentStep];
 const future = maneuvers.slice(currentStep + 1);
 const km = future.reduce((sum, item) => sum + item.length, 0) + (remainingMeters != null ? remainingMeters / 1000 : current?.length ?? 0);
 const seconds = future.reduce((sum, item) => sum + item.time, 0) + (remainingSeconds ?? current?.time ?? 0);
 return { km: Math.max(0, km), seconds: Math.max(0, seconds) };
}

