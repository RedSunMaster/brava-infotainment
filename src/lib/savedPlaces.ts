import { validCoordinates, type Coordinates } from "./locationSearch";

export type PlaceSlot = "home" | "work";
export interface SavedPlace {
	name: string;
	coords: Coordinates;
}
export type SavedPlaces = Partial<Record<PlaceSlot, SavedPlace>>;

const KEY = "brava-saved-places";
const SLOTS: PlaceSlot[] = ["home", "work"];

export function readSavedPlaces(): SavedPlaces {
	try {
		const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
		if (!data || typeof data !== "object") return {};
		const places: SavedPlaces = {};
		for (const slot of SLOTS) {
			const item = (data as Record<string, SavedPlace | undefined>)[slot];
			if (
				item &&
				typeof item.name === "string" &&
				item.name.trim() &&
				Array.isArray(item.coords) &&
				validCoordinates(item.coords)
			)
				places[slot] = { name: item.name.trim(), coords: item.coords };
		}
		return places;
	} catch {
		return {};
	}
}

export function savePlace(
	slot: PlaceSlot,
	name: string,
	coords: Coordinates,
): SavedPlaces {
	const places = readSavedPlaces();
	if (!name.trim() || !validCoordinates(coords)) return places;
	places[slot] = { name: name.trim(), coords: [...coords] };
	try {
		localStorage.setItem(KEY, JSON.stringify(places));
	} catch {
		/* The shortcut still works for this session if storage is full. */
	}
	return places;
}
