/**
 * The dock is a single line of equal cells: a row along the bottom (13 cells), or a column down the left or right edge
 * (as many cells as fit, up to 13). Each function is a tile that takes one or more cells (a fan stepper needs 3, an on/off
 * switch needs 1). A layout is just the tiles in order, packed from the start of the line (left, or top), so "where" a tile
 * sits is its position in the list and "how big" is its span. The same layout is used wherever the dock is placed.
 */
export const DOCK_COLUMNS = 13;

export type DockSide = "bottom" | "left" | "right";
export const DOCK_SIDES: readonly DockSide[] = ["bottom", "left", "right"];
export const isDockSide = (value: unknown): value is DockSide => value === "bottom" || value === "left" || value === "right";
/** How wide a dock at the left or right edge is, in pixels. */
export const SIDE_DOCK_WIDTH = 124;
/** Smallest height of one cell in a side dock, in pixels, so every tile stays easy to hit. */
const MIN_SIDE_CELL = 80;
/** How many cells a side dock has on a screen with this much height available. */
export const sideColumns = (availableHeight: number): number => Math.max(6, Math.min(DOCK_COLUMNS, Math.floor(availableHeight / MIN_SIDE_CELL)));

export type WidgetId = "fan" | "warmth" | "airflow" | "recirculate" | "demist" | "ac" | "hazards" | "volume" | "playPause" | "nextTrack";
export interface WidgetMeta {
	label: string;
	/** Sizes it can take, in cells, smallest first. */
	sizes: readonly number[];
	/** Safety controls that cannot be taken off the dock. */
	pinned?: boolean;
}
export const WIDGETS: Record<WidgetId, WidgetMeta> = {
	// Steppers need room for their two arrows and a value, so they start at 3; switches can be anything from 1 to 4.
	fan: { label: "Fan speed", sizes: [3, 4, 5, 6] },
	warmth: { label: "Warmth", sizes: [3, 4, 5, 6] },
	volume: { label: "Volume", sizes: [3, 4, 5, 6] },
	airflow: { label: "Airflow", sizes: [1, 2, 3, 4] },
	recirculate: { label: "Recirculate", sizes: [1, 2, 3, 4] },
	demist: { label: "Rear demist", sizes: [1, 2, 3, 4] },
	ac: { label: "A/C", sizes: [1, 2, 3, 4] },
	playPause: { label: "Play / pause", sizes: [1, 2, 3, 4] },
	nextTrack: { label: "Next track", sizes: [1, 2, 3, 4] },
	hazards: { label: "Hazard lights", sizes: [1, 2, 3, 4], pinned: true },
};
export const WIDGET_IDS = Object.keys(WIDGETS) as WidgetId[];
export const isWidgetId = (value: unknown): value is WidgetId => typeof value === "string" && Object.prototype.hasOwnProperty.call(WIDGETS, value);

export interface DockItem { id: WidgetId; span: number }
export type DockLayout = DockItem[];

/** The standard dock: fan, four switches, warmth and hazards, filling the whole bar edge to edge. */
export const DEFAULT_LAYOUT: DockLayout = [
	{ id: "fan", span: 4 }, { id: "airflow", span: 1 }, { id: "recirculate", span: 1 }, { id: "demist", span: 1 },
	{ id: "ac", span: 1 }, { id: "warmth", span: 4 }, { id: "hazards", span: 1 },
];
/** The first version's default, which left a cell empty. A dock still stored exactly like this is shown as the new default. */
const LEGACY_DEFAULT: DockLayout = [
	{ id: "fan", span: 3 }, { id: "airflow", span: 1 }, { id: "recirculate", span: 1 }, { id: "demist", span: 1 },
	{ id: "ac", span: 1 }, { id: "warmth", span: 3 }, { id: "hazards", span: 1 },
];
const sameLayout = (a: unknown, b: DockLayout): boolean => Array.isArray(a) && a.length === b.length && a.every((item, i) => item?.id === b[i].id && item?.span === b[i].span);

export const usedCells = (layout: DockLayout): number => layout.reduce((sum, item) => sum + item.span, 0);
export const freeCells = (layout: DockLayout, columns = DOCK_COLUMNS): number => columns - usedCells(layout);
/** First cell (1-based) of each tile, packed from the start of the dock. */
export const startColumns = (layout: DockLayout): number[] => { let at = 1; return layout.map(item => { const start = at; at += item.span; return start; }); };

const nearestSize = (id: WidgetId, span: unknown): number => {
	const sizes = WIDGETS[id].sizes;
	const wanted = typeof span === "number" && Number.isFinite(span) ? span : sizes[0];
	return sizes.reduce((best, size) => (Math.abs(size - wanted) < Math.abs(best - wanted) ? size : best), sizes[0]);
};

/** Shape check for stored data; use `normaliseLayout` before showing it. */
export const isStoredLayout = (value: unknown): value is { id: string; span: number }[] =>
	Array.isArray(value) && value.every(item => !!item && typeof item === "object" && typeof (item as DockItem).id === "string" && typeof (item as DockItem).span === "number");

/**
 * Makes any stored layout safe to show in a dock with `columns` cells: unknown tiles and repeats are dropped, sizes snap
 * to ones the tile supports, and the hazard lights are always there. If it is too big for the dock (a side dock on a short
 * screen), the wide tiles shrink first and only then are tiles from the end left out, so nothing important vanishes needlessly.
 */
export function normaliseLayout(raw: unknown, columns = DOCK_COLUMNS): DockLayout {
	if (sameLayout(raw, LEGACY_DEFAULT)) raw = DEFAULT_LAYOUT;
	const seen = new Set<WidgetId>();
	let layout: DockLayout = [];
	if (Array.isArray(raw)) {
		for (const entry of raw) {
			const id = (entry as DockItem | null)?.id;
			if (!isWidgetId(id) || seen.has(id)) continue;
			seen.add(id);
			layout.push({ id, span: nearestSize(id, (entry as DockItem).span) });
		}
	}
	if (!layout.length) layout = DEFAULT_LAYOUT.map(item => ({ ...item }));
	if (!layout.some(item => item.id === "hazards")) layout.push({ id: "hazards", span: 1 });
	while (usedCells(layout) > columns) {
		// Shrink the widest tile that can still get smaller; if none can, drop the last tile that is not pinned.
		let widest = -1;
		layout.forEach((item, index) => { if (item.span > WIDGETS[item.id].sizes[0] && (widest < 0 || item.span > layout[widest].span)) widest = index; });
		if (widest >= 0) { const sizes = WIDGETS[layout[widest].id].sizes; layout[widest] = { ...layout[widest], span: sizes[sizes.indexOf(layout[widest].span) - 1] }; continue; }
		let last = -1;
		layout.forEach((item, index) => { if (!WIDGETS[item.id].pinned) last = index; });
		if (last < 0) break;
		layout.splice(last, 1);
	}
	return layout;
}

/** Widgets that are not on the dock yet, in a steady order. */
export const availableWidgets = (layout: DockLayout): WidgetId[] => WIDGET_IDS.filter(id => !layout.some(item => item.id === id) && !WIDGETS[id].pinned);

/** A new tile starts at its smallest size. Null when even that does not fit. */
export function sizeThatFits(layout: DockLayout, id: WidgetId, columns = DOCK_COLUMNS): number | null {
	const smallest = WIDGETS[id].sizes[0];
	return smallest <= freeCells(layout, columns) ? smallest : null;
}

export function addWidget(layout: DockLayout, id: WidgetId, columns = DOCK_COLUMNS): DockLayout {
	const span = sizeThatFits(layout, id, columns);
	if (span === null || layout.some(item => item.id === id)) return layout;
	return [...layout, { id, span }];
}

export function removeWidget(layout: DockLayout, id: WidgetId): DockLayout {
	return WIDGETS[id].pinned ? layout : layout.filter(item => item.id !== id);
}

/** Moves a tile so it ends up at `index` in the list (0 is the start of the dock). */
export function moveWidget(layout: DockLayout, id: WidgetId, index: number): DockLayout {
	const from = layout.findIndex(item => item.id === id);
	if (from < 0) return layout;
	const to = Math.max(0, Math.min(layout.length - 1, index));
	if (to === from) return layout;
	const next = layout.slice();
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
}

/** Changes a tile's size one step bigger or smaller, only to a size it supports and that fits. */
export function stepWidgetSize(layout: DockLayout, id: WidgetId, direction: 1 | -1, columns = DOCK_COLUMNS): DockLayout {
	const item = layout.find(entry => entry.id === id);
	if (!item) return layout;
	const sizes = WIDGETS[id].sizes;
	const at = sizes.indexOf(item.span);
	const target = sizes[at + direction];
	if (target === undefined || (direction > 0 && target - item.span > freeCells(layout, columns))) return layout;
	return layout.map(entry => (entry.id === id ? { ...entry, span: target } : entry));
}

export const canStep = (layout: DockLayout, id: WidgetId, direction: 1 | -1, columns = DOCK_COLUMNS): boolean => stepWidgetSize(layout, id, direction, columns) !== layout;

/** How close to an end of the dock a dragged tile has to get to count as "all the way", in cells. */
const END_MAGNET = 0.8;

/**
 * The layout while a tile is dragged: `startCell` is where the tile's leading edge (left, or top) is, in cells from the
 * start of the dock, and `direction` which way it is moving (-1 towards the start). It trades places with a neighbour
 * once it covers half of it: moving towards the start its start edge leads, moving the other way its far edge does.
 * Getting within a little of an end of the dock snaps to that end, so the first and last places are easy to reach
 * without being exact. Returns the same layout when nothing changes.
 */
export function dragWidget(layout: DockLayout, id: WidgetId, startCell: number, direction: 1 | -1, columns = DOCK_COLUMNS): DockLayout {
	let current = layout;
	const at = (list: DockLayout) => list.findIndex(item => item.id === id);
	const span = layout[at(layout)]?.span;
	if (span === undefined) return layout;
	if (direction < 0 && startCell < END_MAGNET) return moveWidget(layout, id, 0);
	if (direction > 0 && startCell + span > columns - END_MAGNET) return moveWidget(layout, id, layout.length - 1);
	for (let guard = 0; guard < layout.length; guard++) {
		const index = at(current);
		const starts = startColumns(current).map(column => column - 1);
		const before = current[index - 1], after = current[index + 1];
		if (direction < 0 && before && startCell < starts[index - 1] + before.span / 2) current = moveWidget(current, id, index - 1);
		else if (direction > 0 && after && startCell + span > starts[index + 1] + after.span / 2) current = moveWidget(current, id, index + 1);
		else break;
	}
	return current;
}
