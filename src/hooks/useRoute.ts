import { useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import { getRoute, NormalizedManeuver, type NormalizedRoute } from "../lib/routing";
import type { RoutingProvider } from "../constants";
import { alpha, useTheme } from "@mui/material";
import { routeLineMetrics, routeLineProgress, trafficGradient } from "../lib/routeLine";

export function useRoute(mapRef: React.RefObject<mapboxgl.Map | null>) {
 const coordsRef = useRef<[number, number][]>([]);
 const maneuversRef = useRef<NormalizedManeuver[]>([]);
 const [maneuvers, setManeuvers] = useState<NormalizedManeuver[]>([]);
 const drawn = useRef<{ coords: [number, number][]; congestion?: string[] } | null>(null);
 const alternatives = useRef<[number, number][][]>([]);
 const alternativesDirty = useRef(false);
 const metrics = useRef(routeLineMetrics([]));
 const progress = useRef(0);
 const theme = useTheme();

 useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  const restore = () => {
   drawAlternatives(alternatives.current);
   if (drawn.current) drawRoute(drawn.current.coords, drawn.current.congestion);
  };
  const restoreWhenReady = () => {
   if (!map.isStyleLoaded()) return;
   if (alternativesDirty.current || (alternatives.current.length && !map.getLayer("route-alternatives"))) drawAlternatives(alternatives.current);
   if (!map.getLayer("route")) restore();
  };
  map.on("style.load", restore);
  map.on("sourcedata", restoreWhenReady);
  if (map.isStyleLoaded()) restore();
  return () => { map.off("style.load", restore); map.off("sourcedata", restoreWhenReady); };
 }, [mapRef.current, theme.palette.primary.main]);

 async function fetchRoute(origin: [number, number], dest: [number, number], provider: RoutingProvider, stops: [number, number][] = []) {
  applyRoute(await getRoute(origin, dest, provider, stops));
 }
 function applyRoute(result: NormalizedRoute) {
  coordsRef.current = result.coords;
  maneuversRef.current = result.maneuvers;
  setManeuvers(result.maneuvers);
  progress.current = 0;
  drawRoute(result.coords, result.congestion);
 }
 function refreshTimings(result: NormalizedRoute) {
  const previous = maneuversRef.current;
  if (previous.length !== result.maneuvers.length || previous.some((step, index) => step.begin_shape_index !== result.maneuvers[index].begin_shape_index || step.type !== result.maneuvers[index].type)) return false;
  const updated = previous.map((step, index) => ({ ...step, time: result.maneuvers[index].time }));
  maneuversRef.current = updated;
  setManeuvers(updated);
  return true;
 }
 function drawAlternatives(routes: [number, number][][]) {
  alternatives.current = routes;
  const map = mapRef.current;
  if (!map?.isStyleLoaded()) { alternativesDirty.current = true; return; }
  alternativesDirty.current = false;
  if (!routes.length) {
   if (map.getLayer("route-alternatives")) map.removeLayer("route-alternatives");
   if (map.getSource("route-alternatives")) map.removeSource("route-alternatives");
   return;
  }
  const data: GeoJSON.FeatureCollection<GeoJSON.LineString> = { type: "FeatureCollection", features: routes.filter(coords => coords.length >= 2).map(coords => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } })) };
  if (!map.getSource("route-alternatives")) {
   map.addSource("route-alternatives", { type: "geojson", data });
   map.addLayer({ id: "route-alternatives", type: "line", source: "route-alternatives", slot: "middle", minzoom: 5, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#747d87", "line-opacity": 0.85, "line-width": 7, "line-emissive-strength": 0.6 } }, map.getLayer("route") ? "route" : undefined);
  } else (map.getSource("route-alternatives") as mapboxgl.GeoJSONSource).setData(data);
 }
 function drawRoute(coords: [number, number][], congestion?: string[]) {
  if (drawn.current?.coords !== coords) {
   drawn.current = { coords, congestion };
   metrics.current = routeLineMetrics(coords);
   progress.current = 0;
  }
  else drawn.current.congestion = congestion;
  const map = mapRef.current;
  if (!map?.isStyleLoaded() || coords.length < 2) return;
  const data: GeoJSON.Feature<GeoJSON.LineString> = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
  if (!map.getSource("route")) map.addSource("route", { type: "geojson", data, lineMetrics: true, tolerance: 0 });
  else (map.getSource("route") as mapboxgl.GeoJSONSource).setData(data);
  const total = metrics.current.meters[metrics.current.meters.length - 1];
  const paint: mapboxgl.LineLayerSpecification["paint"] = {
   "line-color": theme.palette.primary.main,
   "line-gradient": trafficGradient(metrics.current.projected, drawn.current.congestion, theme.palette.primary.main),
   "line-width": 8,
   "line-emissive-strength": 1,
   "line-trim-offset": [0, progress.current],
   "line-trim-color": alpha(theme.palette.primary.main, 0.12),
   "line-trim-fade-range": [0, total > 0 ? Math.min(0.02, 12 / total) : 0],
  };
  if (!map.getLayer("route")) map.addLayer({ id: "route", type: "line", source: "route", slot: "middle", minzoom: 5, layout: { "line-cap": "round", "line-join": "round" }, paint });
  else for (const name of Object.keys(paint) as (keyof typeof paint)[]) map.setPaintProperty("route", name, paint[name]);
 }
 function clearRoute() {
  drawAlternatives([]);
  coordsRef.current = [];
  maneuversRef.current = [];
  drawn.current = null;
  metrics.current = routeLineMetrics([]);
  progress.current = 0;
  setManeuvers([]);
  const map = mapRef.current;
  if (!map) return;
  if (map.getLayer("route")) map.removeLayer("route");
  if (map.getSource("route")) map.removeSource("route");
 }
 function trimRouteByDistance(distanceM: number) {
  const next = routeLineProgress(metrics.current, distanceM);
  if (next === progress.current) return;
  progress.current = next;
  const map = mapRef.current;
  if (map?.getLayer("route")) map.setPaintProperty("route", "line-trim-offset", [0, next]);
 }
 return { coordsRef, maneuversRef, maneuvers, fetchRoute, applyRoute, refreshTimings, drawRoute, drawAlternatives, clearRoute, trimRouteByDistance };
}
