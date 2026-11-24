/**
 * Game modes: ways of playing with the map while driving. One is active at a time (or none). Each mode keeps its own
 * stats, which Settings → Game Modes shows. A mode that needs no picking by the driver, like recording where they have
 * been for Fog of War's map, keeps recording whatever mode is chosen.
 */
export type GameMode = "off" | "fog" | "pacman" | "ghost";

export interface GameModeInfo {
	id: GameMode;
	name: string;
	/** One line, for the picker. */
	tagline: string;
	description: string;
}

export const GAME_MODES: readonly GameModeInfo[] = [
	{ id: "off", name: "No game", tagline: "Plain map", description: "The normal map. Fog of War still records where you drive, so switching it back on loses nothing." },
	{ id: "fog", name: "Fog of War", tagline: "Uncover the map", description: "Covers the map in fog everywhere you have not driven. You see about 50 m either side of the road, and driving right round a park or block uncovers the middle. Your route always shows through." },
	{ id: "pacman", name: "Pac-Man", tagline: "Eat every dot", description: "Every road is dotted. Drive over a dot to eat it; big dots are worth more, and a long run of dots builds a score multiplier. Eaten dots grow back after a time you choose. Your car becomes Pac-Man." },
	{ id: "ghost", name: "Ghost Race", tagline: "Beat your best time", description: "Drive a route you have driven before and your fastest run of it drives along as a ghost on the map. The dashboard says how far ahead or behind it you are, and beating it sets a new best." },
];

/** The active mode, per profile like the other settings. */
export const GAME_MODE_KEY = "brava-game-mode";
/** What Fog of War used before there were modes: its on/off switch. */
const LEGACY_FOG_KEY = "brava-explore-fog";

export const isGameMode = (value: unknown): value is GameMode => value === "off" || value === "fog" || value === "pacman" || value === "ghost";

/** The mode to start with when none is saved yet: Fog of War if it was switched on before modes existed. */
export function initialGameMode(storage: Pick<Storage, "getItem"> | null): GameMode {
	try { return storage?.getItem(LEGACY_FOG_KEY) === "true" ? "fog" : "off"; } catch { return "off"; }
}
