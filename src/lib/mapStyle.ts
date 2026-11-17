import type { Map } from "mapbox-gl";
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
   "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 12, 3, 16, 6, 19, 10],
   "line-opacity": 0.9,
   "line-emissive-strength": 1,
  },
 });
}

export function applyMapAppearance(
 map: Pick<Map, "setConfigProperty" | "setRain" | "setSnow">,
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
}
