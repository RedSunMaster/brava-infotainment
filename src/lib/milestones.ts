/**
 * Explore mode's milestones: round numbers of ground explored, new roads driven and places found, and how much of each
 * suburb has been explored. Each is reached once and kept with the explored map.
 *
 * Pure logic with no map or storage, so it can be tested on its own.
 */

export interface Milestone {
	/** Stable, so a milestone is never reached twice: "area:5", "suburb:relation:123:50". */
	id: string;
	/** What the popup and the list say: "5 km² explored", "Half of Northwood explored". */
	title: string;
	kind: "area" | "roads" | "places" | "suburbs" | "suburb";
	at: number;
}

export interface MilestoneState {
	areaKm2: number;
	newRoadsKm: number;
	/** Towns, suburbs and neighbourhoods discovered (not driven-round areas). */
	places: number;
	/** Each suburb with an outline: its id, name and progress (0 to 1; 1 is fully explored, see shareExplored()). */
	suburbs: { id: string; name: string; share: number }[];
}

export const AREA_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
export const ROAD_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
export const PLACE_STEPS = [5, 10, 25, 50, 100, 250];
export const FULL_SUBURB_STEPS = [1, 5, 10, 25, 50, 100];
/** Progress through one suburb that is announced. At 1 it counts as fully explored. */
export const SUBURB_STEPS = [0.25, 0.5, 0.75, 1];

const SUBURB_WORDS: Record<number, (name: string) => string> = {
	0.25: name => `A quarter of ${name} explored`,
	0.5: name => `Half of ${name} explored`,
	0.75: name => `Three quarters of ${name} explored`,
	1: name => `${name} fully explored`,
};

const number = (value: number) => value.toLocaleString("en-NZ");

/** Every milestone the state has reached, in order (smallest first within each kind). */
export function reachedMilestones(state: MilestoneState, at = Date.now()): Milestone[] {
	const out: Milestone[] = [];
	for (const step of AREA_STEPS) if (state.areaKm2 >= step) out.push({ id: `area:${step}`, title: `${number(step)} km² explored`, kind: "area", at });
	for (const step of ROAD_STEPS) if (state.newRoadsKm >= step) out.push({ id: `roads:${step}`, title: `${number(step)} km of new roads`, kind: "roads", at });
	for (const step of PLACE_STEPS) if (state.places >= step) out.push({ id: `places:${step}`, title: `${number(step)} places discovered`, kind: "places", at });
	const full = state.suburbs.filter(suburb => suburb.share >= 1).length;
	for (const step of FULL_SUBURB_STEPS) if (full >= step) out.push({ id: `suburbs:${step}`, title: step === 1 ? "First suburb fully explored" : `${number(step)} suburbs fully explored`, kind: "suburbs", at });
	for (const suburb of state.suburbs) {
		for (const step of SUBURB_STEPS) if (suburb.share >= step) out.push({ id: `suburb:${suburb.id}:${Math.round(step * 100)}`, title: SUBURB_WORDS[step](suburb.name), kind: "suburb", at });
	}
	return out;
}

/**
 * The milestones reached that are not in `achieved` yet. For one suburb only its highest new step is returned, so
 * driving straight from 20% to 60% announces "Half" and not "A quarter" as well; the lower one is still kept.
 */
export function newMilestones(state: MilestoneState, achieved: ReadonlySet<string>, at = Date.now()): { all: Milestone[]; announce: Milestone[] } {
	const all = reachedMilestones(state, at).filter(milestone => !achieved.has(milestone.id));
	// Of each kind (and each suburb), only the biggest new one is worth a popup.
	const best = new Map<string, Milestone>();
	for (const milestone of all) best.set(milestone.kind === "suburb" ? milestone.id.replace(/:\d+$/, "") : milestone.kind, milestone);
	return { all, announce: [...best.values()] };
}

/** The next milestone of a kind, for "next: 5 km²". */
export function nextStep(steps: readonly number[], value: number): number | null {
	return steps.find(step => step > value) ?? null;
}
