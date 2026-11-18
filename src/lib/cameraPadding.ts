import type { Map } from "mapbox-gl";

/** How far in from each edge of the map the screen is covered by something (status bar and buttons, the dock, a side dock). */
export interface Insets { top: number; bottom: number; left: number; right: number }

const smoothstep = (edge0: number, edge1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t); };

/**
 * How much of the top and bottom insets to use at this zoom. Zoomed out (the globe, a country) the whole view is centred in
 * the free space between the bars, so the Earth sits in the middle of what you can see. Close in, driving, the camera is tuned
 * by hand (the car low on the screen), so the top and bottom insets are not used. Sideways insets always are.
 */
export function verticalShare(zoom: number): number {
	return 1 - smoothstep(5, 9, zoom);
}

/**
 * The most the camera may be tilted at this zoom. The driving view is tilted 45 degrees; a tilted globe leans away and sits off
 * centre, so as you zoom out the tilt is taken back to flat, and the whole Earth comes square on, in the middle of the space.
 */
export function maxPitchFor(zoom: number): number {
	return Math.round(45 * smoothstep(4, 8, zoom) * 10) / 10;
}

/** The zoom from which the camera is looking at a route or a street rather than the Earth, and so keeps its own padding in an overview. */
export const CLOSE_ZOOM = 9;

/** The padding to give the map camera at this zoom, in whole pixels. */
export function paddingFor(insets: Insets, zoom: number): Insets {
	const share = verticalShare(zoom);
	return { top: Math.round(insets.top * share), bottom: Math.round(insets.bottom * share), left: Math.round(insets.left), right: Math.round(insets.right) };
}

/** Mapbox reports padding with every side optional; a missing side is none. */
const whole = (pad: Partial<Insets> | undefined): Insets => ({ top: pad?.top ?? 0, bottom: pad?.bottom ?? 0, left: pad?.left ?? 0, right: pad?.right ?? 0 });

export const samePadding = (a: Partial<Insets>, b: Partial<Insets>, tolerance = 1) => {
	const x = whole(a), y = whole(b);
	return Math.abs(x.top - y.top) < tolerance && Math.abs(x.bottom - y.bottom) < tolerance && Math.abs(x.left - y.left) < tolerance && Math.abs(x.right - y.right) < tolerance;
};

type PaddedMap = Pick<Map, "getContainer" | "getPadding">;

interface CameraTransform { padding: Insets; pitch: number }
const transformOf = (map: object): CameraTransform | null => {
	const transform = (map as { transform?: Partial<CameraTransform> }).transform;
	return transform && typeof transform === "object" && "padding" in transform && "pitch" in transform ? (transform as CameraTransform) : null;
};

/**
 * Changes the camera's padding and tilt in place. Map.setPadding and Map.setPitch both stop whatever the camera is doing, so
 * calling them as the user zooms (every frame) cancels the zoom animation and makes it stall and stutter. Writing to the
 * camera's own transform changes the view without interrupting anything. Falls back to the public methods if a future
 * version of Mapbox changes the transform.
 */
export function setCameraPadding(map: Pick<Map, "setPadding" | "triggerRepaint">, padding: Insets) {
	const transform = transformOf(map);
	if (transform) { transform.padding = padding; map.triggerRepaint(); } else map.setPadding(padding);
}
export function setCameraPitch(map: Pick<Map, "setPitch" | "triggerRepaint">, pitch: number) {
	const transform = transformOf(map);
	if (transform) { transform.pitch = pitch; map.triggerRepaint(); } else map.setPitch(pitch);
}

/**
 * The camera offset that puts the car where \`fraction\` says (0 is the middle of the screen, 0.2 a fifth of the screen below it)
 * whatever padding the camera has. Mapbox measures an offset from the middle of the padded area, so the padding is taken off.
 * Sideways there is no offset: the padded middle is already the middle of the free space.
 */
export function puckOffset(map: PaddedMap, fraction: number): [number, number] {
	const height = map.getContainer().clientHeight;
	const pad = whole(map.getPadding());
	const middle = pad.top + (height - pad.top - pad.bottom) / 2;
	return [0, height * (0.5 + fraction) - middle];
}

/** Where the car normally sits on screen, in pixels from the map's top left. */
export function puckScreenPoint(map: PaddedMap, fraction: number): [number, number] {
	const container = map.getContainer();
	const pad = whole(map.getPadding());
	return [pad.left + (container.clientWidth - pad.left - pad.right) / 2, container.clientHeight * (0.5 + fraction)];
}
