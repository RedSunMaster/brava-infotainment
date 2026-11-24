import type { Map as MapboxMap } from "mapbox-gl";

/**
 * Pac-Man mode's look for the map: a black board where the roads are the maze, drawn as black corridors with glowing blue
 * walls, the buildings dark blue blocks, and no names, icons, trees or weather to clutter it. The map keeps its own style
 * (Mapbox Standard): its colours and switches are changed while the mode is on and put back afterwards, and the walls and
 * corridors are two extra line layers drawn from Mapbox's road data.
 */
const WALL_BLUE = "#2323ff";
const BLOCK_BLUE = "#2a2ad8";
const BLACK = "#000000";
const WATER = "#02021a";

/** The Standard style's settings changed while the mode is on. */
const LOOK: Record<string, string | number | boolean> = {
	colorLand: BLACK, colorWater: WATER, colorGreenspace: "#03030f", colorCommercial: "#03030f", colorIndustrial: "#03030f", colorMedical: "#03030f", colorEducation: "#03030f",
	colorRoads: BLACK, colorMotorways: BLACK, colorTrunks: BLACK, colorHdRoads: BLACK, roadsBrightness: 0,
	colorBuildings: BLOCK_BLUE, colorAdminBoundaries: BLACK,
	showPlaceLabels: false, showRoadLabels: false, showTransitLabels: false, showPointOfInterestLabels: false, showLandmarkIcons: false, showLandmarkIconLabels: false,
	showAdminBoundaries: false, showPedestrianRoads: false, show3dObjects: false, show3dBuildings: false, show3dTrees: false, show3dLandmarks: false, show3dFacades: false,
};

const SOURCE = "brava-pacman-streets";
export const PACMAN_BOARD = "brava-pacman-board";
const BOARD = PACMAN_BOARD, GLOW = "brava-pacman-glow", WALLS = "brava-pacman-walls", FLOORS = "brava-pacman-floors";
// Seen from space: coastlines and borders as maze walls, big cities as dots.
const COAST_GLOW = "brava-pacman-coast-glow", COAST = "brava-pacman-coast", BORDERS = "brava-pacman-borders", CITIES = "brava-pacman-cities";
const LAYERS = [BOARD, COAST_GLOW, COAST, BORDERS, CITIES, GLOW, WALLS, FLOORS] as const;
/** The app's own layers on the globe (cloud cover and the night shadow), hidden under this look. */
const GLOBE_EXTRAS = ["brava-clouds", "brava-clouds-b", "brava-night"] as const;
/** The peach of the arcade's pellets. */
const CITY_COLOUR = "#fab9b0";
/**
 * The world map (coasts, borders, cities) fades out over a long stretch of zoom, and the roads fade in over another that
 * starts before it ends, so one takes over from the other with no jump. The roads are in the tiles from about zoom 6 (the big
 * ones), and are kept at least a hairline thick until their true width is more than that.
 */
const WORLD_UNTIL = 16;
const ROADS_FROM = 6;
const fade = (...stops: number[]): mapboxgl.ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], ...stops] as unknown as mapboxgl.ExpressionSpecification;
/** The navigation route is drawn by the app in the same slot: the maze goes under it. */
const ROUTE_LAYERS = ["route-alternatives", "route-casing", "route"] as const;
/** Road kinds that make the maze: the ones a car can drive on, as the dots do. */
const DRIVABLE = ["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "street", "street_limited", "service"];
/** Corridor widths in metres by kind of road. */
const WIDTH_M = ["match", ["get", "class"], "motorway", 16, "trunk", 14, "primary", 12, "secondary", 11, "tertiary", 10, "motorway_link", 8, "trunk_link", 8, "primary_link", 8, "secondary_link", 8, "tertiary_link", 8, "service", 5, 8] as unknown as mapboxgl.ExpressionSpecification;

/** A width in metres (or an expression for one) as pixels: it grows with the zoom so a road keeps its real width. */
const pixels = (metres: unknown, extraM = 0, atLeast = 0): mapboxgl.ExpressionSpecification => {
	const total = ["+", metres, extraM];
	return ["interpolate", ["exponential", 2], ["zoom"], 6, ["max", atLeast, ["*", total, 0.0011]], 22, ["max", atLeast, ["*", total, 73.3]]] as unknown as mapboxgl.ExpressionSpecification;
};

let saved: Record<string, unknown> | null = null;
/** What the app's globe layers were showing before they were hidden, to put back. */
const hidden = new Map<string, string>();

/** Puts the map into Pac-Man's look (and does nothing more if it already is). */
export function applyPacmanStyle(map: MapboxMap): void {
	try {
		if (!saved) {
			saved = {};
			for (const key of Object.keys(LOOK)) { try { saved[key] = map.getConfigProperty("basemap", key); } catch { /* Not in this version of the style. */ } }
		}
		for (const [key, value] of Object.entries(LOOK)) { try { map.setConfigProperty("basemap", key, value); } catch { /* Not in this version of the style. */ } }
		if (!map.getSource(SOURCE)) map.addSource(SOURCE, { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" });
		const filter = ["all", ["==", ["geometry-type"], "LineString"], ["in", ["get", "class"], ["literal", DRIVABLE]]] as unknown as mapboxgl.ExpressionSpecification;
		const base = { type: "line" as const, minzoom: ROADS_FROM, source: SOURCE, "source-layer": "road", slot: "middle", filter, layout: { "line-cap": "round" as const, "line-join": "round" as const } };
		// A soft blue glow, then the walls, then the black floors laid over the walls: every road's floor covers the walls of the
		// roads it meets, so junctions open up instead of being crossed by walls.
		const below = ROUTE_LAYERS.find(id => map.getLayer(id));
		// A black board over the map's own land, water and flat building footprints (which the map draws even with its 3D
		// buildings off), so only the maze shows.
		if (!map.getLayer(BOARD)) map.addLayer({ id: BOARD, type: "background", slot: "middle", paint: { "background-color": BLACK, "background-emissive-strength": 1 } }, below);
		// The globe, and the world map before the roads: land and sea both black, the coasts and borders drawn as the maze's
		// walls, the big cities as pellets.
		const world = { source: SOURCE, slot: "middle", maxzoom: WORLD_UNTIL } as const;
		const waterEdge = { ...world, type: "line" as const, "source-layer": "water", layout: { "line-join": "round" as const } };
		if (!map.getLayer(COAST_GLOW)) map.addLayer({ ...waterEdge, id: COAST_GLOW, paint: { "line-color": WALL_BLUE, "line-width": 5, "line-blur": 4, "line-opacity": fade(0, 0.3, 11, 0.3, 15, 0), "line-emissive-strength": 1 } }, below);
		if (!map.getLayer(COAST)) map.addLayer({ ...waterEdge, id: COAST, paint: { "line-color": WALL_BLUE, "line-width": fade(0, 1, 6, 2.2, 12, 2.2), "line-opacity": fade(0, 1, 11, 1, 15, 0), "line-emissive-strength": 1 } }, below);
		if (!map.getLayer(BORDERS)) map.addLayer({ ...world, id: BORDERS, type: "line", "source-layer": "admin", filter: ["all", ["==", ["get", "admin_level"], 0], ["==", ["get", "maritime"], "false"]] as unknown as mapboxgl.ExpressionSpecification, paint: { "line-color": WALL_BLUE, "line-width": 1.2, "line-dasharray": [2, 2], "line-opacity": fade(0, 0.85, 8, 0.85, 12, 0), "line-emissive-strength": 1 } }, below);
		if (!map.getLayer(CITIES)) map.addLayer({ ...world, id: CITIES, type: "circle", "source-layer": "place_label", filter: ["==", ["get", "class"], "settlement"] as unknown as mapboxgl.ExpressionSpecification, paint: { "circle-color": CITY_COLOUR, "circle-radius": fade(0, 2.4, 6, 4.2), "circle-opacity": fade(0, 1, 8, 1, 11, 0), "circle-emissive-strength": 1 } }, below);
		for (const id of GLOBE_EXTRAS) {
			if (!map.getLayer(id)) continue;
			if (!hidden.has(id)) hidden.set(id, String(map.getLayoutProperty(id, "visibility") ?? "visible"));
			map.setLayoutProperty(id, "visibility", "none");
		}
		if (!map.getLayer(GLOW)) map.addLayer({ ...base, id: GLOW, paint: { "line-color": WALL_BLUE, "line-width": pixels(WIDTH_M, 7, 2.5), "line-blur": 6, "line-opacity": fade(6, 0.2, 10, 0.45), "line-emissive-strength": 1 } }, below);
		if (!map.getLayer(WALLS)) map.addLayer({ ...base, id: WALLS, paint: { "line-color": WALL_BLUE, "line-width": pixels(WIDTH_M, 4.4, 1.3), "line-opacity": fade(6, 0.6, 10, 1), "line-emissive-strength": 1 } }, below);
		if (!map.getLayer(FLOORS)) map.addLayer({ ...base, id: FLOORS, paint: { "line-color": BLACK, "line-width": pixels(WIDTH_M), "line-emissive-strength": 1 } }, below);
	} catch (cause) { console.warn("Pac-Man map look could not be applied:", cause); }
}

/** Puts the map's own look back. */
export function removePacmanStyle(map: MapboxMap): void {
	try {
		for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
		for (const [id, visibility] of hidden) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility as "visible" | "none");
		hidden.clear();
		if (map.getSource(SOURCE)) map.removeSource(SOURCE);
		if (saved) {
			for (const [key, value] of Object.entries(saved)) { try { if (value !== undefined && value !== null) map.setConfigProperty("basemap", key, value); } catch { /* Not in this version of the style. */ } }
			saved = null;
		}
	} catch (cause) { console.warn("Pac-Man map look could not be removed:", cause); }
}
