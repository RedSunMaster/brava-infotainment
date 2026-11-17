import type { ExpressionSpecification, FogSpecification, Map } from "mapbox-gl";
import type { AmbientWeather } from "./ambientTheme";

export type WeatherAppearance = "auto" | "clear" | "rain" | "snow";
export type TimeOfDay = "dawn" | "day" | "dusk" | "night";
export const MAP_STYLE = "mapbox://styles/mapbox/standard";

export function applyTerrain(map: Pick<Map, "getSource" | "addSource" | "setTerrain">) {
 if (!map.getSource("brava-terrain")) map.addSource("brava-terrain", {
  type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14,
 });
 map.setTerrain({ source: "brava-terrain", exaggeration: 1 });
}

export const TRAFFIC_COLORS = { moderate: "#f59e0b", heavy: "#ef4444", severe: "#991b1b" } as const;

const TRAFFIC_OPACITY = 0.9;
const TRAFFIC_OPACITY_DIMMED = 0.3;
const ROAD_CLASS_WIDTH: ExpressionSpecification = ["match", ["get", "class"], ["motorway", "trunk"], 1.5, ["primary"], 1.2, ["secondary", "tertiary"], 1, 0.75];

/** Live congestion drawn on the roads themselves: orange = slow, red = heavy, dark red = stopped. */
export function applyTraffic(map: Pick<Map, "getSource" | "getLayer" | "addSource" | "addLayer">) {
 if (!map.getSource("brava-traffic")) map.addSource("brava-traffic", { type: "vector", url: "mapbox://mapbox.mapbox-traffic-v1" });
 if (map.getLayer("brava-traffic")) return;
 map.addLayer({
  id: "brava-traffic", type: "line", source: "brava-traffic", "source-layer": "traffic", slot: "middle", minzoom: 8,
  filter: ["in", ["get", "congestion"], ["literal", Object.keys(TRAFFIC_COLORS)]],
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
   "line-color": ["match", ["get", "congestion"], "moderate", TRAFFIC_COLORS.moderate, "heavy", TRAFFIC_COLORS.heavy, "severe", TRAFFIC_COLORS.severe, "rgba(0,0,0,0)"],
   // Wider on motorways and main roads, thinner on side streets.
   "line-width": ["interpolate", ["linear"], ["zoom"], 8, ["*", ROAD_CLASS_WIDTH, 1.5], 12, ["*", ROAD_CLASS_WIDTH, 3], 16, ["*", ROAD_CLASS_WIDTH, 6], 19, ["*", ROAD_CLASS_WIDTH, 10]],
   "line-opacity": TRAFFIC_OPACITY,
   "line-emissive-strength": 1,
  },
 });
}

const FOG_COLORS: Record<TimeOfDay, { color: string; high: string; space: string; stars: number }> = {
 dawn: { color: "#f1cdb4", high: "#7d9bd1", space: "#1b2442", stars: 0.25 },
 day: { color: "#d9e8f5", high: "#5b9ae0", space: "#0b1730", stars: 0 },
 dusk: { color: "#e7a98f", high: "#5a5a9c", space: "#14183a", stars: 0.35 },
 night: { color: "#0c1629", high: "#18274a", space: "#020814", stars: 0.8 },
};

/** Horizon haze that follows the lighting preset and thickens in rain or snow. */
export function fogFor(period: TimeOfDay, precipitating = false): FogSpecification {
 const palette = FOG_COLORS[period];
 return {
  color: palette.color,
  "high-color": palette.high,
  "space-color": palette.space,
  "star-intensity": palette.stars,
  "horizon-blend": precipitating ? 0.1 : 0.04,
  range: precipitating ? [0.4, 5] : [0.8, 9],
 };
}

export function setTrafficAppearance(map: Pick<Map, "getLayer" | "setLayoutProperty" | "setPaintProperty">, { visible, dimmed }: { visible: boolean; dimmed: boolean }) {
 if (!map.getLayer("brava-traffic")) return;
 map.setLayoutProperty("brava-traffic", "visibility", visible ? "visible" : "none");
 map.setPaintProperty("brava-traffic", "line-opacity", dimmed ? TRAFFIC_OPACITY_DIMMED : TRAFFIC_OPACITY);
}

export function applyMapAppearance(
 map: Pick<Map, "setConfigProperty" | "setRain" | "setSnow" | "setFog">,
 period: TimeOfDay,
 weather: AmbientWeather | null,
 now = Date.now(),
 appearance: WeatherAppearance = "auto",
) {
 map.setConfigProperty("basemap", "lightPreset", period);
 const fresh = weather && now >= weather.observedAt && now - weather.observedAt < 30 * 60000;
 const code = fresh ? weather.code : -1;
 const snow = appearance === "snow" || (appearance === "auto" && [71, 73, 75, 77, 85, 86].includes(code));
 const rain = appearance === "rain" || (appearance === "auto" && [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code));
 // Keep precipitation subtle enough that navigation remains readable.
 const density = appearance === "auto" ? (fresh ? Math.min(0.5, Math.max(0.1, weather.precipitation / 10)) : 0) : 0.25;
 map.setRain(rain ? { density, intensity: 0.5, opacity: 0.5, vignette: 0 } : null);
 map.setSnow(snow ? { density, intensity: 0.5, opacity: 0.5, vignette: 0 } : null);
 map.setFog(fogFor(period, rain || snow));
}
