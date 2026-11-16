import type { Map } from "mapbox-gl";
import type { AmbientWeather } from "./ambientTheme";

export type WeatherAppearance = "auto" | "clear" | "rain" | "snow";
export type TimeOfDay = "dawn" | "day" | "dusk" | "night";
export const MAP_STYLE = "mapbox://styles/mapbox/standard";

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
