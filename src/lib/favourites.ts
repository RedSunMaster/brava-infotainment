import { validCoordinates, type Coordinates } from "./locationSearch";

/** Pins a person can choose for a place. The first is the default for a new favourite. */
export const MARKERS = ["⭐", "❤️", "☕", "🍔", "🛒", "⛽", "🏋️", "🌳", "🏫", "🍺", "🏠", "💼"] as const;
export const DEFAULT_FAVOURITE_MARKER = MARKERS[0];
export const isMarker = (value: unknown): value is string => typeof value === "string" && (MARKERS as readonly string[]).includes(value);
export const nextMarker = (current: string | undefined): string => MARKERS[(MARKERS.findIndex(item => item === current) + 1) % MARKERS.length];

export interface Favourite { id: string; name: string; coords: Coordinates; buildingCoords?: Coordinates; marker: string }

const KEY = "brava-favourites";
const MAX = 30;

export function readFavourites(): Favourite[] {
	try {
		const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		if (!Array.isArray(data)) return [];
		return data.filter((item): item is Favourite =>
			!!item && typeof item.id === "string" && typeof item.name === "string" && item.name.trim().length > 0 &&
			Array.isArray(item.coords) && validCoordinates(item.coords)).map(item => ({
			id: item.id, name: item.name.trim(), coords: item.coords, marker: isMarker(item.marker) ? item.marker : DEFAULT_FAVOURITE_MARKER,
			...(Array.isArray(item.buildingCoords) && validCoordinates(item.buildingCoords) ? { buildingCoords: item.buildingCoords } : {}),
		})).slice(0, MAX);
	} catch { return []; }
}

function write(list: Favourite[]): Favourite[] {
	try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* The list still works for this session. */ }
	return list;
}

/** Adds a favourite; the same name at the same spot is updated instead of duplicated. */
export function addFavourite(name: string, coords: Coordinates, buildingCoords?: Coordinates): Favourite[] {
	const list = readFavourites();
	if (!name.trim() || !validCoordinates(coords)) return list;
	const same = list.find(item => item.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase() && Math.abs(item.coords[0] - coords[0]) < 0.0001 && Math.abs(item.coords[1] - coords[1]) < 0.0001);
	if (same) {
		if (buildingCoords && validCoordinates(buildingCoords)) same.buildingCoords = buildingCoords;
		return write(list);
	}
	if (list.length >= MAX) return list;
	return write([...list, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), coords: [...coords], marker: DEFAULT_FAVOURITE_MARKER, ...(buildingCoords && validCoordinates(buildingCoords) ? { buildingCoords } : {}) }]);
}

export function setFavouriteMarker(id: string, marker: string): Favourite[] {
	return write(readFavourites().map(item => item.id === id && isMarker(marker) ? { ...item, marker } : item));
}

export function removeFavourite(id: string): Favourite[] {
	return write(readFavourites().filter(item => item.id !== id));
}
