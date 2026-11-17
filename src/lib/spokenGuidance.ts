import { toSpeech } from "./spokenText";
import { spokenDistance } from "./spokenDistance";
import type { Lane } from "./laneGuidance";

/** Below this the instruction is spoken on its own, with no "In … metres". */
export const NEAR_METRES = 80;
/** A second turn this close after the first is mentioned with it ("Then, turn right"). */
export const THEN_WITHIN_M = 250;
/** A lane cue is only useful with room left to change lanes. */
export const LANE_CUE_MIN_M = 120;
/** ...and not so early that it is forgotten before it matters. */
export const LANE_CUE_MAX_M = 700;

export interface GuidanceStep {
	/** Identifies the manoeuvre, so the same wording twice in a row is still announced twice. */
	id: number;
	instruction: string;
	type: number | string;
	modifier?: string;
	/** Metres from this manoeuvre to the next one. */
	lengthM: number;
	lanes?: Lane[];
	/** The last manoeuvre: arriving at the destination. */
	final: boolean;
}

export type Stage = "advance" | "near";

// Valhalla numbers its arrivals: 4 destination, 5 on the right, 6 on the left.
function isArrival(step: GuidanceStep): boolean {
	return step.type === "arrive" || [4, 5, 6].includes(Number(step.type));
}

function arrivalSide(step: GuidanceStep): string {
	const side = step.modifier ?? (Number(step.type) === 5 ? "right" : Number(step.type) === 6 ? "left" : "");
	return /left/.test(side) ? "on the left" : /right/.test(side) ? "on the right" : "ahead";
}

/** "Your destination is on the right." Said before you arrive, because "You have arrived" would be early. */
function arrivalPhrase(step: GuidanceStep, future: boolean): string {
	return `Your ${step.final ? "destination" : "stop"} ${future ? "will be" : "is"} ${arrivalSide(step)}.`;
}

const COUNT_WORDS = ["", "", "two", "three", "four", "five"];

/** "Use the left lane." when the lanes that work for this turn sit together at one side or in the middle. */
export function lanePhrase(step: GuidanceStep): string | null {
	const lanes = step.lanes;
	if (!lanes || lanes.length < 2) return null;
	const usable = lanes.map((lane, index) => (lane.valid ? index : -1)).filter((index) => index >= 0);
	if (usable.length === 0 || usable.length === lanes.length) return null;
	const first = usable[0];
	const last = usable[usable.length - 1];
	if (last - first + 1 !== usable.length) return null; // Separate lanes: too fiddly to say.
	const count = usable.length;
	const word = count === 1 ? "lane" : `${COUNT_WORDS[count] ?? count} lanes`;
	if (first === 0) return `Use the left ${word}.`;
	if (last === lanes.length - 1) return `Use the right ${word}.`;
	if (count === 1 && lanes.length % 2 === 1 && first === (lanes.length - 1) / 2) return "Use the middle lane.";
	return null;
}

// Manoeuvres with nothing to say when chained ("Then, continue").
const MINOR = new Set(["continue", "new name", "notification", "depart"]);

function shorten(instruction: string): string {
	const text = toSpeech(instruction).replace(/\s+(onto|on|toward|towards|for)\s+.+$/i, "").replace(/\.$/, "");
	return text.charAt(0).toLowerCase() + text.slice(1);
}

/** "Then, turn right." for a manoeuvre that follows closely, or null when there is nothing worth adding. */
export function thenPhrase(next: GuidanceStep): string | null {
	if (isArrival(next)) return `Then, ${arrivalPhrase(next, true).replace(/^Your/, "your")}`;
	if (MINOR.has(String(next.type)) || !next.instruction) return null;
	return `Then, ${shorten(next.instruction)}.`;
}

/**
 * The short phrases to speak for the manoeuvre at `index`, in order. They are separate so the
 * common ones ("In 200 metres,", "Use the left lane.") are made once and reused for every turn.
 */
export function announcementParts(steps: GuidanceStep[], index: number, stage: Stage, distanceM: number | null): string[] {
	const step = steps[index];
	if (!step) return [];
	const arrival = isArrival(step);
	if (!arrival && !step.instruction) return [];
	const parts: string[] = [];
	const far = stage === "advance" && distanceM != null && distanceM > NEAR_METRES;
	if (far) parts.push(spokenDistance(distanceM));
	if (far && !arrival && (distanceM ?? 0) > LANE_CUE_MIN_M && (distanceM ?? 0) <= LANE_CUE_MAX_M) {
		const lane = lanePhrase(step);
		if (lane) parts.push(lane);
	}
	parts.push(arrival ? arrivalPhrase(step, far) : toSpeech(step.instruction));
	const next = steps[index + 1];
	if (next && !arrival && step.lengthM <= THEN_WITHIN_M) {
		const then = thenPhrase(next);
		if (then) parts.push(then);
	}
	return parts;
}
