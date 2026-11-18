import { useEffect, useRef } from "react";
import type mapboxgl from "mapbox-gl";
import { applyMapAppearance, type Lighting, type TimeOfDay, type WeatherAppearance } from "../lib/mapStyle";
import { useThemeMode } from "../ThemeContext";
import type { AmbientWeather } from "../lib/ambientTheme";

export function useMapStyle(
 mapRef: React.RefObject<mapboxgl.Map | null>,
 mapLoaded: boolean,
 period: TimeOfDay,
 weather: AmbientWeather | null,
 appearance: WeatherAppearance,
 onStyleLoaded?: () => void,
) {
 const callback = useRef(onStyleLoaded);
 callback.current = onStyleLoaded;
 // Where the car is and whether the time of day was picked by hand: read when the camera moves, without restarting everything on each GPS update.
 const { forced, position } = useThemeMode();
 const lighting = useRef<Lighting>({ anchor: position, forced });
 lighting.current = { anchor: position, forced };
 useEffect(() => {
  const map = mapRef.current;
  if (!map || !mapLoaded) return;
  let pending = true;
  const apply = () => { if (pending && map.isStyleLoaded()) { pending = false; applyMapAppearance(map, period, weather, Date.now(), appearance, () => lighting.current); } };
  const restore = () => { pending = true; apply(); callback.current?.(); };
  map.on("style.load", restore);
  map.on("sourcedata", apply);
  apply();
  return () => { map.off("style.load", restore); map.off("sourcedata", apply); };
 }, [mapRef, mapLoaded, period, weather, appearance]);
 return { period };
}
