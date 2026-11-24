import type { ExpressionSpecification, FogSpecification, Map } from "mapbox-gl";
import type { AmbientWeather } from "./ambientTheme";
import { MERCATOR_LATITUDE, renderLightsMask, renderNightMask, solarAltitude, sunPosition, type Sun } from "./sunlight";

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

/** The key that turns the globe's clouds on or off (per profile, like the other settings). */
export const CLOUDS_KEY = "brava-earth-clouds";
export const cloudsWanted = (): boolean => { try { return localStorage.getItem(CLOUDS_KEY) !== "false"; } catch { return true; } };

/** The clouds are two copies of the same picture side by side, so they can slide round the world without a gap. */
const CLOUD_LAYERS = ["brava-clouds", "brava-clouds-b"] as const;
const MERCATOR_EDGE = 85.0511287798;
/** How far the clouds have drifted round the world, in degrees east of where they are in the picture. */
let cloudShift = 0;
const cloudCoordinates = (shift: number, copy: 0 | 1): [[number, number], [number, number], [number, number], [number, number]] => {
 const left = -180 + shift - 360 * copy, right = left + 360;
 return [[left, MERCATOR_EDGE], [right, MERCATOR_EDGE], [right, -MERCATOR_EDGE], [left, -MERCATOR_EDGE]];
};
/** How bright the clouds are at each time of day. Always full white: the globe's night side is darkened by its own layer drawn over the clouds, and dimming them here as well left them grey on the day side. */
const CLOUD_BRIGHTNESS: Record<TimeOfDay, number> = { day: 1, dawn: 1, dusk: 1, night: 1 };

/**
 * A layer of clouds over the whole globe, so the Earth looks like Earth from space. It is a flat picture drawn on the globe, and
 * it fades out as the camera comes in (the globe flattens into the ordinary map around zoom 5 to 6) and is not drawn at all beyond
 * zoom 6, so it costs nothing while driving.
 */
export function applyClouds(map: Pick<Map, "getSource" | "getLayer" | "addSource" | "addLayer" | "setLayoutProperty">, url: string, visible: boolean) {
 CLOUD_LAYERS.forEach((id, copy) => {
  if (!map.getSource(id)) map.addSource(id, { type: "image", url, coordinates: cloudCoordinates(cloudShift, copy as 0 | 1) });
  if (!map.getLayer(id)) map.addLayer({
   id, type: "raster", source: id, slot: "middle", maxzoom: 6,
   layout: { visibility: visible ? "visible" : "none" },
   paint: {
    "raster-opacity": ["interpolate", ["linear"], ["zoom"], 0, 1, 2.5, 1, 4, 0.4, 5.5, 0],
    "raster-fade-duration": 0, "raster-resampling": "linear", "raster-emissive-strength": 1, "raster-brightness-max": 1,
   },
  });
  else map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
 });
}

export function setCloudsVisible(map: Pick<Map, "getLayer" | "setLayoutProperty">, visible: boolean) {
 for (const id of CLOUD_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
}

export function setCloudAppearance(map: Pick<Map, "getLayer" | "setPaintProperty">, period: TimeOfDay) {
 for (const id of CLOUD_LAYERS) if (map.getLayer(id)) map.setPaintProperty(id, "raster-brightness-max", CLOUD_BRIGHTNESS[period]);
}

/** Slides the clouds `degrees` further east over the ground. */
export function driftClouds(map: Pick<Map, "getSource">, degrees: number) {
 cloudShift = (((cloudShift + degrees) % 360) + 360) % 360;
 CLOUD_LAYERS.forEach((id, copy) => (map.getSource(id) as unknown as { setCoordinates?: (coordinates: unknown) => void } | undefined)?.setCoordinates?.(cloudCoordinates(cloudShift, copy as 0 | 1)));
}

/** The key that turns the globe's day and night sides on or off (per profile). */
export const NIGHT_KEY = "brava-globe-night";
export const nightWanted = (): boolean => { try { return localStorage.getItem(NIGHT_KEY) !== "false"; } catch { return true; } };

const NIGHT_LAYER = "brava-night";
const NIGHT_SIZE = 768;
const nightCoordinates: [[number, number], [number, number], [number, number], [number, number]] = [[-180, MERCATOR_LATITUDE], [180, MERCATOR_LATITUDE], [180, -MERCATOR_LATITUDE], [-180, -MERCATOR_LATITUDE]];
let nightUrl: string | null = null;
/** Where the sun was for the picture on the globe, so the atmosphere glow can follow it. Null when the night side is off. */
let globeSun: Sun | null = null;

const LIGHTS_SIZE = 2048;
let lightsImage: HTMLImageElement | null = null;
let lightsLoading: Promise<HTMLImageElement | null> | null = null;
/** The city-lights picture, loaded once. Null if it cannot be loaded; the night side is then just the shade. */
function loadLights(url: string | undefined): Promise<HTMLImageElement | null> {
 if (lightsImage) return Promise.resolve(lightsImage);
 if (!url || typeof Image === "undefined") return Promise.resolve(null);
 lightsLoading ??= new Promise(resolve => {
  const image = new Image();
  image.onload = () => { lightsImage = image; resolve(image); };
  image.onerror = () => { lightsLoading = null; resolve(null); };
  image.src = url;
 });
 return lightsLoading;
}
const scratch = (size: number) => { const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size; return canvas; };

/** A picture of where it is night right now, as a blob URL the map can draw. */
async function nightPicture(date: Date, lightsUrl?: string): Promise<string | null> {
 if (typeof document === "undefined") return null;
 const sun = sunPosition(date);
 const shade = scratch(NIGHT_SIZE);
 const shadeContext = shade.getContext("2d");
 if (!shadeContext) return null;
 shadeContext.putImageData(new ImageData(renderNightMask(sun, NIGHT_SIZE), NIGHT_SIZE, NIGHT_SIZE), 0, 0);
 const lights = await loadLights(lightsUrl);
 let picture = shade;
 if (lights) {
  // The shade, with the city lights on top wherever it is properly dark. Both masks are smooth, so the small ones are stretched up.
  picture = scratch(LIGHTS_SIZE);
  const context = picture.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.drawImage(shade, 0, 0, LIGHTS_SIZE, LIGHTS_SIZE);
  const glow = scratch(LIGHTS_SIZE);
  const glowContext = glow.getContext("2d")!;
  glowContext.imageSmoothingQuality = "high";
  glowContext.drawImage(lights, 0, 0, LIGHTS_SIZE, LIGHTS_SIZE);
  const mask = scratch(NIGHT_SIZE);
  mask.getContext("2d")!.putImageData(new ImageData(renderLightsMask(sun, NIGHT_SIZE), NIGHT_SIZE, NIGHT_SIZE), 0, 0);
  glowContext.globalCompositeOperation = "destination-in";
  glowContext.drawImage(mask, 0, 0, LIGHTS_SIZE, LIGHTS_SIZE);
  context.drawImage(glow, 0, 0);
 }
 const blob = await new Promise<Blob | null>(resolve => picture.toBlob(resolve, lights ? "image/webp" : "image/png", 0.92));
 return blob ? URL.createObjectURL(blob) : null;
}

type NightMap = Pick<Map, "getSource" | "getLayer" | "addSource" | "addLayer" | "setLayoutProperty">;

/**
 * The day and night sides of the Earth: a shadow laid over the globe from where the sun really is, darkest on the far side with a
 * soft, warm edge where it is dusk or dawn, and the lights of the cities coming on wherever it is properly dark. Like the clouds it fades out as the camera comes in, a little later than they do, and is not drawn beyond zoom 8.
 * Added after the clouds so the clouds on the night side go dark too.
 */
export async function applyNight(map: NightMap, visible: boolean, date = new Date(), lightsUrl?: string) {
 if (!visible) { globeSun = null; if (map.getLayer(NIGHT_LAYER)) map.setLayoutProperty(NIGHT_LAYER, "visibility", "none"); repaintGlow(map as unknown as WeatherMap); return; }
 const url = await nightPicture(date, lightsUrl);
 if (!url) return;
 globeSun = sunPosition(date);
 const previous = nightUrl;
 nightUrl = url;
 const existing = map.getSource(NIGHT_LAYER) as unknown as { updateImage?: (options: { url: string; coordinates: typeof nightCoordinates }) => void } | undefined;
 if (existing?.updateImage) existing.updateImage({ url, coordinates: nightCoordinates });
 else if (!existing) map.addSource(NIGHT_LAYER, { type: "image", url, coordinates: nightCoordinates });
 if (!map.getLayer(NIGHT_LAYER)) map.addLayer({
  id: NIGHT_LAYER, type: "raster", source: NIGHT_LAYER, slot: "middle", maxzoom: 8,
  // It stays well after the lighting preset has been switched (at about zoom 4.6), so the map darkens underneath it instead of flashing bright.
  paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 0, 1, 3, 0.95, 4.5, 0.75, 6, 0.4, 7.5, 0], "raster-fade-duration": 0, "raster-resampling": "linear", "raster-emissive-strength": 1 },
 });
 map.setLayoutProperty(NIGHT_LAYER, "visibility", "visible");
 repaintGlow(map as unknown as WeatherMap);
 if (previous) setTimeout(() => URL.revokeObjectURL(previous), 5000);
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

/**
 * How much of the local weather shows at this camera height: none from space (so the globe keeps its blue atmosphere, black sky and
 * stars whatever the weather is where you are), fading in as the camera comes down, all of it near the ground. Rounded to a few
 * steps so it only changes the map a handful of times during a flight.
 */
export function weatherStrength(zoom: number): number {
 const t = Math.max(0, Math.min(1, (zoom - 6) / 5));
 return Math.round(t * t * (3 - 2 * t) * 20) / 20;
}

type WeatherMap = Pick<Map, "setConfigProperty" | "setRain" | "setSnow" | "setFog" | "getCanvas"> & Partial<Pick<Map, "getLayer" | "setPaintProperty" | "getZoom" | "getCenter" | "on">>;
/**
 * What lights the map. Wherever the camera is looking, the map is lit for the real time of day at that place, so zooming into a place
 * that is night shows it at night. Only near the car does the app's own choice (which also takes the weather into account, and
 * any time of day you picked by hand) apply.
 */
export interface Lighting {
 /** Where the car is; null when that is not known. */
 anchor: [number, number] | null;
 /** The time of day was chosen by hand (or by a test flag), so it applies wherever you look. */
 forced: boolean;
}
const FORCED: () => Lighting = () => ({ anchor: null, forced: true });
/** How near the camera has to be to the car for the car's own lighting and weather to apply. */
const NEAR_KM = 250;
const kilometres = ([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]) => {
 const rad = Math.PI / 180;
 const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
 return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** The time of day at a place from the real sun, with the app's own limits: twilight is the sun within 6 degrees of the horizon. */
export function skyPeriod(latitude: number, longitude: number, sun: Sun): TimeOfDay {
 const altitude = solarAltitude(latitude, longitude, sun);
 if (altitude > 6) return "day";
 if (altitude < -6) return "night";
 // East of the sun's longitude it is afternoon (the sun is moving west), so a low sun there is dusk.
 return ((longitude - sun.longitude + 540) % 360) - 180 > 0 ? "dusk" : "dawn";
}

/** How long the light takes to change from one preset to the next (day to dusk, dusk to night...), so it eases instead of snapping. */
export const PRESET_FADE_MS = 6000;
const DEFAULT_TRANSITION = { duration: 300, delay: 0 };
type Transitions = { style?: { setTransition?: (transition: { duration: number; delay: number }) => void } };
const fadeTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();

/**
 * Switches the map's lighting preset. Mapbox swaps presets instantly unless the style is told to transition, so for the length of the
 * change the style's transition is stretched (and put back afterwards, so other changes such as route colours stay quick).
 * `smooth` is false for the very first lighting, which should simply be there.
 */
/** A look that takes over the map from the time of day and the weather (Pac-Man mode's black board), or null for none. */
let lookOverride: TimeOfDay | null = null;
export function setLookOverride(preset: TimeOfDay | null): void { lookOverride = preset; }
/** Whether a game's look is on the map, and the event sent when it comes on or goes off (so other drawing, like the route, can follow). */
export const gameLookOn = (): boolean => lookOverride !== null;
export const LOOK_EVENT = "brava-look-changed";

export function setLightPreset(map: Pick<Map, "setConfigProperty">, preset: TimeOfDay, smooth = true) {
 preset = lookOverride ?? preset;
 const style = (map as unknown as Transitions).style;
 if (smooth && typeof style?.setTransition === "function") {
  try {
   style.setTransition({ duration: PRESET_FADE_MS, delay: 0 });
   const previous = fadeTimers.get(map);
   if (previous) clearTimeout(previous);
   const timer = setTimeout(() => { try { style.setTransition?.(DEFAULT_TRANSITION); } catch { /* The map is gone. */ } }, PRESET_FADE_MS + 250);
   (timer as { unref?: () => void }).unref?.();
   fadeTimers.set(map, timer);
  } catch { /* Fall back to the instant change. */ }
 }
 map.setConfigProperty("basemap", "lightPreset", preset);
}

interface Shown { period: TimeOfDay; effect: WeatherEffect; strength: number; space: number; preset: TimeOfDay; glow: number; view: TimeOfDay; near: boolean; lighting: () => Lighting }
const shown = new WeakMap<object, Shown>();
const listening = new WeakSet<object>();
let cachedSun: { minute: number; sun: Sun } | null = null;
/** The sun now, worked out once a minute. */
function sunNow(): Sun {
 const minute = Math.floor(Date.now() / 60000);
 if (!cachedSun || cachedSun.minute !== minute) cachedSun = { minute, sun: sunPosition(new Date()) };
 return cachedSun.sun;
}

/** The time of day to light the view for, and whether the view is near the car (so the car's weather applies). */
function look(map: WeatherMap, period: TimeOfDay, lighting: Lighting): { view: TimeOfDay; near: boolean } {
 if (lighting.forced || !map.getCenter) return { view: period, near: true };
 const centre = map.getCenter();
 const near = !lighting.anchor || kilometres([centre.lng, centre.lat], lighting.anchor) < NEAR_KM;
 return { view: near ? period : skyPeriod(centre.lat, centre.lng, globeSun ?? sunNow()), near };
}

/**
 * How much the camera is looking at the Earth from space, 1 on the globe, fading to 0 as it comes down to the ground (the globe
 * becomes the flat map around zoom 5 to 6). Rounded to a few steps.
 */
export function spaceShare(zoom: number): number {
 const t = Math.max(0, Math.min(1, (zoom - 3.5) / 3));
 return Math.round((1 - t * t * (3 - 2 * t)) * 20) / 20;
}

/**
 * Which lighting preset the map should use. The globe is always shown in full daylight, because its night side is drawn by the
 * shadow layer from the real sun; the preset for the time of day at the place in view takes over once the camera has come down. The gap
 * between the two zooms stops it flickering back and forth.
 */
export function presetFor(period: TimeOfDay, zoom: number, current: TimeOfDay, nightLayer: boolean, view: TimeOfDay = period): TimeOfDay {
 if (!nightLayer) return view;
 if (zoom < 4) return "day";
 if (zoom > 4.6) return view;
 return current;
}

/**
 * How sunlit the part of the Earth under the camera is, 1 in full daylight down to 0 in the dark. Mapbox draws the atmosphere's glow evenly
 * round the whole globe, so this is used to let it fade on the night side instead of glowing white over a dark Earth.
 */
export function glowLight(latitude: number, longitude: number, sun: Sun | null): number {
 if (!sun) return 1;
 const altitude = solarAltitude(latitude, longitude, sun);
 const t = Math.max(0, Math.min(1, (altitude + 18) / 26));
 return Math.round(t * t * (3 - 2 * t) * 20) / 20;
}
const NIGHT_GLOW = { color: "#16264d", high: "#0b1431" };

/** Fog, rain, snow and the dimming of the whole picture, each scaled by how close to the ground the camera is. */
function paintWeather(map: WeatherMap, period: TimeOfDay, effect: WeatherEffect, strength: number, space = 0, glow = 1) {
 // A game's look has no weather: a clear night.
 if (lookOverride) {
  map.setRain(null);
  map.setSnow(null);
  // Black space and no stars, with a faint blue rim to the globe.
  map.setFog({ color: "#000000", "high-color": "#00003a", "space-color": "#000000", "horizon-blend": 0.04, "star-intensity": 0 });
  map.getCanvas().style.filter = "";
  return;
 }
 const scale = (precipitation: Precipitation | undefined) => (precipitation && strength > 0 ? { ...precipitation, opacity: precipitation.opacity * strength, vignette: precipitation.vignette * strength } : null);
 // A dark vignette at the screen edges sells the gloomy, enclosed feel.
 const rain = scale(effect.rain);
 map.setRain(rain ? { ...rain, "vignette-color": "#1c222b" } : null);
 map.setSnow(scale(effect.snow));
 const fog = fogFor(period, effect.cloud * strength, effect.mist * strength);
 // Space is dark and full of stars whatever the time of day where you are.
 if (space > 0) fog["star-intensity"] = Math.max(Number(fog["star-intensity"] ?? 0), 0.55 * space);
 // Seen from space the day-time haze colour is near white, which made the Earth glow too much: pull it towards the blue of the upper
 // atmosphere and thin the glow, in step with how far out the camera is.
 if (space > 0) {
  fog.color = mixHex(String(fog.color), String(fog["high-color"]), 0.65 * space);
  fog["horizon-blend"] = Number(fog["horizon-blend"] ?? 0.04) * (1 - space);
 }
 // The glow follows the sun: bright over the day side, a faint blue over the night side.
 const darkness = space * (1 - glow);
 if (darkness > 0) {
  fog.color = mixHex(String(fog.color), NIGHT_GLOW.color, 0.85 * darkness);
  fog["high-color"] = mixHex(String(fog["high-color"]), NIGHT_GLOW.high, 0.85 * darkness);
 }
 map.setFog(fog);
 // Fog only shows near the horizon, which the driving view hardly reaches, so cloud also mutes the whole picture.
 const cloud = Math.max(effect.cloud, effect.mist) * strength;
 const dim = period === "night" ? 0 : 0.14 * cloud;
 map.getCanvas().style.filter = cloud > 0 ? `saturate(${(1 - 0.4 * cloud).toFixed(2)}) brightness(${(1 - dim).toFixed(2)})` : "";
}

/** Paints the atmosphere again after the sun or the night side changed. */
function repaintGlow(map: WeatherMap) {
 const current = shown.get(map);
 if (!current || !map.getCenter || !map.getZoom) return;
 current.glow = glowLight(map.getCenter().lat, map.getCenter().lng, globeSun);
 paintWeather(map, current.view, current.effect, current.strength, current.space, current.glow);
}

export function applyMapAppearance(
 map: WeatherMap,
 period: TimeOfDay,
 weather: AmbientWeather | null,
 now = Date.now(),
 appearance: WeatherAppearance = "auto",
 lighting: () => Lighting = FORCED,
) {
 const zoom = map.getZoom ? map.getZoom() : 20;
 const { view, near } = look(map, period, lighting());
 const preset = presetFor(period, zoom, view, nightWanted(), view);
 // The first lighting is simply there; every change after that fades.
 setLightPreset(map, preset, shown.has(map));
 if (map.getLayer && map.setPaintProperty) setCloudAppearance(map as Pick<Map, "getLayer" | "setPaintProperty">, view);
 const { effect } = resolveWeather(appearance, weather, now);
 const strength = map.getZoom && !near ? 0 : map.getZoom ? weatherStrength(zoom) : 1;
 const space = map.getZoom ? spaceShare(zoom) : 0;
 const glow = map.getCenter ? glowLight(map.getCenter().lat, map.getCenter().lng, globeSun) : 1;
 shown.set(map, { period, effect, strength, space, preset, glow, view, near, lighting });
 paintWeather(map, view, effect, strength, space, glow);
 // As the camera climbs, descends or turns: fade the weather out or in, bring in the stars, follow the sun for the lighting preset
 // and the glow. One listener per map, always painting the latest weather.
 if (map.on && map.getZoom && !listening.has(map)) {
  listening.add(map);
  const onCamera = () => {
   const current = shown.get(map);
   if (!current) return;
   const height = map.getZoom!();
   const seen = look(map, current.period, current.lighting());
   const next = seen.near ? weatherStrength(height) : 0, nextSpace = spaceShare(height);
   const nextPreset = presetFor(current.period, height, current.preset, nightWanted(), seen.view);
   if (nextPreset !== current.preset) { current.preset = nextPreset; setLightPreset(map, nextPreset); }
   const nextGlow = nextSpace > 0 && map.getCenter ? glowLight(map.getCenter().lat, map.getCenter().lng, globeSun) : current.glow;
   if (next === current.strength && nextSpace === current.space && nextGlow === current.glow && seen.view === current.view) return;
   current.strength = next;
   current.space = nextSpace;
   current.glow = nextGlow;
   current.view = seen.view;
   current.near = seen.near;
   paintWeather(map, seen.view, current.effect, next, nextSpace, nextGlow);
  };
  // Zooming changes the weather and the stars; turning the globe or flying somewhere changes the time of day and the glow.
  map.on("zoom", onCamera);
  map.on("move", onCamera);
 }
}
