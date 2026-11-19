/**
 * Which parts of the map a touch may pick a destination from.
 *
 * The map fills the screen and the controls float over it. The containers around those controls let touches
 * through, so the gaps between buttons and the margins around them used to reach the map and set a destination.
 * A touch only counts when it is clear of every control by a margin.
 */
export interface Box { left: number; top: number; right: number; bottom: number }

/** How far a touch must be from a button, in px, to count as meant for the map. Also closes the gaps between neighbouring buttons. */
export const CONTROL_MARGIN = 24;

/** True when the point is inside any box once the box is grown by `margin`. */
export function isBlockedPoint(x: number, y: number, boxes: readonly Box[], margin = 0): boolean {
	return boxes.some((b) => x >= b.left - margin && x <= b.right + margin && y >= b.top - margin && y <= b.bottom + margin);
}

const CONTROLS = "button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='slider'], [role='switch'], [role='menuitem']";
/** Whole panels and bars: blocked across their full area, not just where their buttons are. */
const SURFACES = "[data-map-obstruction], [data-dock], [data-dock-side], [data-top-overlay] > *:not(nav)";

function visibleBox(el: Element): Box | null {
	const r = el.getBoundingClientRect();
	return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
}

/** Whether a touch at these screen coordinates is on the usable map: clear of buttons, panels and the dock. */
export function isUsableMapPoint(clientX: number, clientY: number, mapContainer: Element): boolean {
	const outside = (el: Element) => !mapContainer.contains(el);
	const controls = Array.from(document.querySelectorAll(CONTROLS)).filter(outside).map(visibleBox).filter((b): b is Box => b !== null);
	if (isBlockedPoint(clientX, clientY, controls, CONTROL_MARGIN)) return false;
	const surfaces = Array.from(document.querySelectorAll(SURFACES)).filter(outside).map(visibleBox).filter((b): b is Box => b !== null);
	return !isBlockedPoint(clientX, clientY, surfaces, CONTROL_MARGIN / 2);
}
