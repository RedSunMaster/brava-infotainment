import type { ExpressionSpecification, FogSpecification, Map } from "mapbox-gl";
import type { AmbientWeather } from "./ambientTheme";

export const WEATHER_APPEARANCES = ["auto", "clear", "partly", "overcast", "fog", "drizzle", "rain", "storm", "snow", "blizzard"] as const;
export type WeatherAppearance = (typeof WEATHER_APPEARANCES)[number];
export type WeatherKind = Exclude<WeatherAppearance, "auto">;

interface Precipitation { density: number; intensity: number; opacity: number; vignette: number }
/** cloud: 0 clear to 1 solid overcast; mist: 0 to 1 thickness of ground-level fog. */
export interface WeatherEffect { cloud: number; mist: number; rain?: Precipitation; snow?: Precipitation }

// Kept subtle enough that the road and route stay readable.
export const WEATHER_EFFECTS: Record<WeatherKind, WeatherEffect> = {
 clear: { cloud: 0, mist: 0 },
 partly: { cloud: 0.4, mist: 0 },
 overcast: { cloud: 1, mist: 0 },
 fog: { cloud: 0.8, mist: 1 },
 drizzle: { cloud: 0.85, mist: 0.1, rain: { density: 0.15, intensity: 0.2, opacity: 0.35, vignette: 0.15 } },
 rain: { cloud: 0.9, mist: 0.15, rain: { density: 0.3, intensity: 0.5, opacity: 0.5, vignette: 0.3 } },
 storm: { cloud: 1, mist: 0.25, rain: { density: 0.6, intensity: 0.9, opacity: 0.6, vignette: 0.5 } },
 snow: { cloud: 0.8, mist: 0.1, snow: { density: 0.3, intensity: 0.4, opacity: 0.8, vignette: 0.15 } },
 blizzard: { cloud: 1, mist: 0.6, snow: { density: 0.8, intensity: 0.9, opacity: 0.9, vignette: 0.4 } },
};

export const WEATHER_LABELS: Record<WeatherKind, string> = {
 clear: "Clear", partly: "Partly cloudy", overcast: "Overcast", fog: "Fog", drizzle: "Drizzle",
 rain: "Rain", storm: "Thunderstorm", snow: "Snow", blizzard: "Heavy snow",
};

function kindForCode(code: number): WeatherKind {
 if (code === 2) return "partly";
 if (code === 3) return "overcast";
 if (code === 45 || code === 48) return "fog";
 if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
 if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
 if ([95, 96, 99].includes(code)) return "storm";
 if ([71, 73, 77, 85].includes(code)) return "snow";
 if ([75, 86].includes(code)) return "blizzard";
 return "clear";
}

/** Which weather the map is showing: the chosen preview, or the latest local observation under "auto". */
export function resolveWeather(appearance: WeatherAppearance, weather: AmbientWeather | null, now = Date.now()): { kind: WeatherKind; effect: WeatherEffect } {
 if (appearance !== "auto") return { kind: appearance, effect: WEATHER_EFFECTS[appearance] };
 const fresh = weather && now >= weather.observedAt && now - weather.observedAt < 30 * 60000;
 if (!fresh) return { kind: "clear", effect: WEATHER_EFFECTS.clear };
 const kind = kindForCode(weather.code);
 const base = WEATHER_EFFECTS[kind];
 // Real observations can say more about the sky than the weather code does.
 return { kind, effect: { ...base, cloud: Math.max(base.cloud, weather.cloudCover / 100) } };
}
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

// What the sky and haze turn into under a full cloud deck at each time of day.
const OVERCAST_COLORS: Record<TimeOfDay, { color: string; high: string }> = {
 dawn: { color: "#8c8f99", high: "#6a6f80" },
 day: { color: "#a3adb6", high: "#7f8b98" },
 dusk: { color: "#80808f", high: "#58586b" },
 night: { color: "#141b28", high: "#10182a" },
};

function mixHex(from: string, to: string, amount: number) {
 const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
 return "#" + [0, 1, 2].map((i) => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * amount).toString(16).padStart(2, "0")).join("");
}

/**
 * Horizon haze that follows the lighting preset. Mapbox has no cloud layer, so cloud (0 to 1) is
 * approximated by greying the sky, and mist (0 to 1) by pulling the haze in close.
 */
export function fogFor(period: TimeOfDay, cloudCover = 0, mist = 0): FogSpecification {
 const palette = FOG_COLORS[period];
 const overcast = OVERCAST_COLORS[period];
 const clamp = (value: number) => Math.max(0, Math.min(1, value));
 const cloud = clamp(Math.max(cloudCover, mist));
 return {
  color: mixHex(palette.color, overcast.color, cloud),
  "high-color": mixHex(palette.high, overcast.high, cloud),
  "space-color": mixHex(palette.space, overcast.high, cloud * 0.6),
  "star-intensity": palette.stars * (1 - cloud),
  "horizon-blend": 0.04 + 0.06 * cloud + 0.2 * mist,
  // Distances are measured from the map centre, so at driving pitch the top of the screen is only about 1 away:
  // fog has to start near the car and finish within that to be seen at all.
  range: [Math.max(-0.4, 0.8 - 0.4 * cloud - 1.2 * mist), Math.max(1.3, 9 - 4 * cloud - 7 * mist)],
 };
}

export function setTrafficAppearance(map: Pick<Map, "getLayer" | "setLayoutProperty" | "setPaintProperty">, { visible, dimmed }: { visible: boolean; dimmed: boolean }) {
 if (!map.getLayer("brava-traffic")) return;
 map.setLayoutProperty("brava-traffic", "visibility", visible ? "visible" : "none");
 map.setPaintProperty("brava-traffic", "line-opacity", dimmed ? TRAFFIC_OPACITY_DIMMED : TRAFFIC_OPACITY);
}

export function applyMapAppearance(
 map: Pick<Map, "setConfigProperty" | "setRain" | "setSnow" | "setFog" | "getCanvas">,
 period: TimeOfDay,
 weather: AmbientWeather | null,
 now = Date.now(),
 appearance: WeatherAppearance = "auto",
) {
 map.setConfigProperty("basemap", "lightPreset", period);
 const { effect } = resolveWeather(appearance, weather, now);
 // A dark vignette at the screen edges sells the gloomy, enclosed feel.
 map.setRain(effect.rain ? { ...effect.rain, "vignette-color": "#1c222b" } : null);
 map.setSnow(effect.snow ?? null);
 map.setFog(fogFor(period, effect.cloud, effect.mist));
 // Fog only shows near the horizon, which the driving view hardly reaches, so cloud also mutes the whole picture.
 const cloud = Math.max(effect.cloud, effect.mist);
 const dim = period === "night" ? 0 : 0.14 * cloud;
 map.getCanvas().style.filter = cloud > 0 ? `saturate(${(1 - 0.4 * cloud).toFixed(2)}) brightness(${(1 - dim).toFixed(2)})` : "";
}
