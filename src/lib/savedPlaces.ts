import { validCoordinates, type Coordinates } from "./locationSearch";
import { isMarker } from "./favourites";

export type PlaceSlot = "home" | "work";
/** What the address picker is choosing: Home, Work, or a new favourite. */
export type PlaceTarget = PlaceSlot | "favourite";
export interface SavedPlace {
	name: string;
	coords: Coordinates;
	buildingCoords?: Coordinates;
	/** The pin shown on the map; Home and Work default to a house and a briefcase. */
	marker?: string;
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
				places[slot] = { name: item.name.trim(), coords: item.coords,
					...(Array.isArray(item.buildingCoords) && validCoordinates(item.buildingCoords) ? { buildingCoords: item.buildingCoords } : {}),
					...(isMarker(item.marker) ? { marker: item.marker } : {}) };
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
	buildingCoords?: Coordinates,
): SavedPlaces {
	const places = readSavedPlaces();
	if (!name.trim() || !validCoordinates(coords)) return places;
	const marker = places[slot]?.marker;
	places[slot] = { name: name.trim(), coords: [...coords], ...(marker ? { marker } : {}), ...(buildingCoords && validCoordinates(buildingCoords) ? { buildingCoords } : {}) };
	try {
		localStorage.setItem(KEY, JSON.stringify(places));
	} catch {
		/* The shortcut still works for this session if storage is full. */
	}
	return places;
}

export const defaultMarker = (slot: PlaceSlot): string => (slot === "home" ? "🏠" : "💼");

export function setPlaceMarker(slot: PlaceSlot, marker: string): SavedPlaces {
	const places = readSavedPlaces();
	if (!places[slot] || !isMarker(marker)) return places;
	places[slot] = { ...places[slot]!, marker };
	try { localStorage.setItem(KEY, JSON.stringify(places)); } catch { /* Kept for this session only. */ }
	return places;
}
