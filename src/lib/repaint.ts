import type { Map } from "mapbox-gl";

/** Frame interval for slow, steady animations (the car's pulse when parked, drifting fog, blinking pellets): about 30 fps. */
export const IDLE_FRAME_MS = 33;

const pending = new WeakMap<Map, number>();

/**
 * Asks for another frame in about IDLE_FRAME_MS rather than at once. For animations that look the same at 30 fps: while nothing else
 * moves, the map then draws at 30 fps instead of 60, which halves the work the car computer does parked (and the heat it builds up,
 * which slowed it down once driving). Anything that asks with triggerRepaint() still gets the very next frame.
 */
export function repaintSoon(map: Map): void {
	if (pending.has(map)) return;
	pending.set(map, window.setTimeout(() => { pending.delete(map); map.triggerRepaint(); }, IDLE_FRAME_MS));
}
