import { useEffect, useRef } from "react";
import type mapboxgl from "mapbox-gl";

/** Puck position, as a share of the map's height below its centre, when nothing covers the map. */
export const CLOSED_OFFSET = 0.2;
/** The puck never goes higher than this when a panel opens (a tenth of the way down). */
const HIGHEST_OFFSET = -0.4;

/**
 * Camera offset that keeps the puck the same distance above an open panel as it normally is above
 * the dock, instead of centring it in whatever space is left. `gap` is that distance in pixels.
 */
export function offsetForPanels(height: number, tops: number[], gap = height * 0.15): number {
 if (!tops.length || height <= 0) return CLOSED_OFFSET;
 const puckY = Math.min(...tops) - gap;
 return Math.min(CLOSED_OFFSET, Math.max(HIGHEST_OFFSET, puckY / height - 0.5));
}

const GLIDE_MS = 450;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Tracks panels that cover the map and returns the vertical camera offset that
 * keeps the puck visible above them. The returned ref glides to each new value
 * instead of stepping; the puck render loop reads it every frame and moves the
 * camera, so the map slides smoothly whether the car is parked or moving.
 */
export function useMapOcclusion(mapRef: React.RefObject<mapboxgl.Map | null>, loaded: boolean) {
 const offset = useRef(CLOSED_OFFSET);
 // How far the puck sits above the dock when nothing is open, measured so an open panel can keep the same distance.
 const closedGap = useRef<number | null>(null);
 useEffect(() => {
  const map = mapRef.current;
  if (!map || !loaded) return;
  let frame = 0;
  let glide = 0;
  let target = offset.current;
  const resize = new ResizeObserver(schedule);
  let observed: Element[] = [];
  function glideTo(next: number) {
   target = next;
   const from = offset.current;
   const started = performance.now();
   cancelAnimationFrame(glide);
   const step = (now: number) => {
    const t = Math.min(1, (now - started) / GLIDE_MS);
    offset.current = from + (next - from) * easeInOut(t);
    map.triggerRepaint();
    if (t < 1) glide = requestAnimationFrame(step);
   };
   glide = requestAnimationFrame(step);
  }
  function update() {
   frame = 0;
   const panels = Array.from(document.querySelectorAll("[data-map-obstruction]"));
   if (panels.length !== observed.length || panels.some((p, i) => p !== observed[i])) {
    resize.disconnect();
    resize.observe(map.getContainer());
    panels.forEach(panel => resize.observe(panel));
    observed = panels;
   }
   const bounds = map.getContainer().getBoundingClientRect();
   if (!bounds.height) return;
   const tops = panels.map(panel => panel.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom).map(rect => Math.max(0, rect.top - bounds.top));
   if (!panels.length) {
    const dock = document.querySelector("[data-dock]")?.getBoundingClientRect();
    if (dock && dock.height > 0) closedGap.current = Math.max(0, dock.top - bounds.top - (0.5 + CLOSED_OFFSET) * bounds.height);
   }
   const next = offsetForPanels(bounds.height, tops, closedGap.current ?? undefined);
   if (Math.abs(next - target) >= 0.01) glideTo(next);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  schedule();
  return () => { observer.disconnect(); resize.disconnect(); if (frame) cancelAnimationFrame(frame); cancelAnimationFrame(glide); };
 }, [mapRef, loaded]);
 return offset;
}
