import { useEffect, useRef } from "react";
import type mapboxgl from "mapbox-gl";
import { applyMapAppearance, type TimeOfDay, type WeatherAppearance } from "../lib/mapStyle";
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
 useEffect(() => {
  const map = mapRef.current;
  if (!map || !mapLoaded) return;
  const apply = () => applyMapAppearance(map, period, weather, Date.now(), appearance);
  const restore = () => { apply(); callback.current?.(); };
  map.on("style.load", restore);
  apply();
  return () => { map.off("style.load", restore); };
 }, [mapRef, mapLoaded, period, weather, appearance]);
 return { period };
}
