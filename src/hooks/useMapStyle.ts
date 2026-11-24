import { useEffect, useRef } from "react";
import type mapboxgl from "mapbox-gl";
import { PACMAN_BOARD, applyPacmanStyle, removePacmanStyle } from "../lib/pacmanStyle";
import { LOOK_EVENT, applyMapAppearance, setLookOverride, type Lighting, type TimeOfDay, type WeatherAppearance } from "../lib/mapStyle";
import { useThemeMode } from "../ThemeContext";
import type { AmbientWeather } from "../lib/ambientTheme";

export function useMapStyle(
 mapRef: React.RefObject<mapboxgl.Map | null>,
 mapLoaded: boolean,
 period: TimeOfDay,
 weather: AmbientWeather | null,
 appearance: WeatherAppearance,
 onStyleLoaded?: () => void,
 /** Pac-Man mode's black-board look in place of the time of day and weather. */
 gameLook = false,
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
  setLookOverride(gameLook ? "night" : null);
  const apply = () => {
   if (!pending || !map.isStyleLoaded()) return;
   pending = false;
   applyMapAppearance(map, period, weather, Date.now(), appearance, () => lighting.current);
   if (gameLook) applyPacmanStyle(map); else removePacmanStyle(map);
   window.dispatchEvent(new Event(LOOK_EVENT));
  };
  const restore = () => { pending = true; apply(); callback.current?.(); };
  map.on("style.load", restore);
  map.on("sourcedata", apply);
  apply();
  // The game look is put on as soon as the style exists, not only once everything in it has loaded (a map seen as a globe
  // may take a while to say so).
  const ensureLook = () => { if (gameLook && !map.getLayer(PACMAN_BOARD)) applyPacmanStyle(map); };
  map.on("styledata", ensureLook);
  ensureLook();
  return () => { map.off("style.load", restore); map.off("sourcedata", apply); map.off("styledata", ensureLook); };
 }, [mapRef, mapLoaded, period, weather, appearance, gameLook]);
 return { period };
}
