export interface Lane { indications: string[]; valid: boolean; active?: boolean; valid_indication?: string }

/** Rotation of an upward arrow for each lane indication the Directions API can report. */
export const INDICATION_ANGLE: Record<string, number> = {
	uturn: 180,
	"sharp left": -135,
	left: -90,
	"slight left": -45,
	straight: 0,
	"slight right": 45,
	right: 90,
	"sharp right": 135,
};

/** Lane guidance appears this far before the turn; any earlier it is just noise. */
export const LANE_SHOW_WITHIN_M = 1000;

/** The arrows worth drawing for a lane ("none" marks a lane with no painted arrow). */
export function laneArrows(lane: Lane): string[] {
	return lane.indications.filter((indication) => indication in INDICATION_ANGLE);
}

/**
 * Which arrow in a usable lane is the one to take. A lane can allow several directions
 * (straight or right); the API names the one that leads along the route when it knows.
 */
export function laneHighlight(lane: Lane, modifier?: string): string | null {
	if (!lane.valid) return null;
	const arrows = laneArrows(lane);
	if (lane.valid_indication && arrows.includes(lane.valid_indication)) return lane.valid_indication;
	if (modifier && arrows.includes(modifier)) return modifier;
	return arrows[0] ?? null;
}

/**
 * The lanes to show, or null when guidance would not help: a single lane, no usable lane,
 * every lane usable (nothing to choose), or the turn is still far away.
 */
export function usefulLanes(lanes: Lane[] | undefined, distanceM: number | null | undefined): Lane[] | null {
	if (!lanes || lanes.length < 2) return null;
	const valid = lanes.filter((lane) => lane.valid).length;
	if (valid === 0 || valid === lanes.length) return null;
	if (distanceM != null && distanceM > LANE_SHOW_WITHIN_M) return null;
	return lanes;
}

export function describeLanes(lanes: Lane[], modifier?: string): string {
	return lanes.map((lane, index) => {
		const direction = laneHighlight(lane, modifier) ?? laneArrows(lane)[0] ?? "no arrow";
		return `lane ${index + 1}: ${direction}${lane.valid ? ", use" : ", avoid"}`;
	}).join("; ");
}
