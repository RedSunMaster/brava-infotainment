import { validCoordinates, type Coordinates } from "./locationSearch";
export interface FrequentPlace { name: string; coords: Coordinates; buildingCoords?: Coordinates; visits: number; lastVisited: number }
const KEY = "brava-frequent-places";
export function readFrequentPlaces(): FrequentPlace[] {
 try {
  const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  if (!Array.isArray(data)) return [];
  for (const item of data) {
   if (item && typeof item === "object" && item.buildingCoords && (!Array.isArray(item.buildingCoords) || !validCoordinates(item.buildingCoords))) delete item.buildingCoords;
  }
  return data.filter((item): item is FrequentPlace => item && typeof item.name === "string" && item.name.trim().length > 0 && Array.isArray(item.coords) && item.coords.length === 2 && item.coords.every((v: unknown) => typeof v === "number" && Number.isFinite(v)) && validCoordinates(item.coords) && Number.isSafeInteger(item.visits) && item.visits > 0 && Number.isFinite(item.lastVisited)).sort((a, b) => b.visits - a.visits || b.lastVisited - a.lastVisited).slice(0, 20);
 } catch { return []; }
}
export function recordFrequentPlace(name: string, coords: Coordinates, buildingCoords?: Coordinates): void {
 if (!name.trim() || !validCoordinates(coords)) return;
 try {
  const places = readFrequentPlaces();
  const existing = places.find(item => item.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase() && Math.abs(item.coords[0] - coords[0]) < 0.0001 && Math.abs(item.coords[1] - coords[1]) < 0.0001);
  if (existing) { existing.visits++; existing.lastVisited = Date.now(); }
  else places.push({ name: name.trim(), coords: [...coords], visits: 1, lastVisited: Date.now() });
  const place = existing ?? places[places.length - 1];
  if (buildingCoords && validCoordinates(buildingCoords)) place.buildingCoords = buildingCoords;
  places.sort((a, b) => b.visits - a.visits || b.lastVisited - a.lastVisited);
  localStorage.setItem(KEY, JSON.stringify(places.slice(0, 20)));
 } catch { /* Navigation remains available when storage is unavailable. */ }
}
