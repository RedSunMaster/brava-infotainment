/**
 * The dock is a single row of 13 equal cells. Each function is a tile that takes one or more cells
 * (a fan stepper needs 3, an on/off switch needs 1). A layout is just the tiles in order, packed from
 * the left, so "where" a tile sits is its position in the list and "how big" is its span.
 */
export const DOCK_COLUMNS = 13;

export type WidgetId = "fan" | "warmth" | "airflow" | "recirculate" | "demist" | "ac" | "hazards" | "volume" | "playPause" | "nextTrack";
export interface WidgetMeta {
	label: string;
	/** Sizes it can take, in cells, smallest first. */
	sizes: readonly number[];
	/** Safety controls that cannot be taken off the dock. */
	pinned?: boolean;
}
export const WIDGETS: Record<WidgetId, WidgetMeta> = {
	fan: { label: "Fan speed", sizes: [3, 4, 5] },
	warmth: { label: "Warmth", sizes: [3, 4, 5] },
	volume: { label: "Volume", sizes: [3, 4, 5] },
	airflow: { label: "Airflow", sizes: [1] },
	recirculate: { label: "Recirculate", sizes: [1] },
	demist: { label: "Rear demist", sizes: [1] },
	ac: { label: "A/C", sizes: [1] },
	playPause: { label: "Play / pause", sizes: [1] },
	nextTrack: { label: "Next track", sizes: [1] },
	hazards: { label: "Hazard lights", sizes: [1], pinned: true },
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
export const freeCells = (layout: DockLayout): number => DOCK_COLUMNS - usedCells(layout);
/** First column (1-based) of each tile, packed from the left. */
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
 * Makes any stored layout safe to show: unknown tiles and repeats are dropped, sizes snap to ones the tile
 * supports, anything that would not fit is left out, and the hazard lights are always there.
 */
export function normaliseLayout(raw: unknown): DockLayout {
	if (sameLayout(raw, LEGACY_DEFAULT)) return DEFAULT_LAYOUT.map(item => ({ ...item }));
	const seen = new Set<WidgetId>();
	const layout: DockLayout = [];
	if (Array.isArray(raw)) {
		for (const entry of raw) {
			const id = (entry as DockItem | null)?.id;
			if (!isWidgetId(id) || seen.has(id)) continue;
			const span = nearestSize(id, (entry as DockItem).span);
			if (usedCells(layout) + span > DOCK_COLUMNS) continue;
			seen.add(id);
			layout.push({ id, span });
		}
	}
	if (!layout.length) return DEFAULT_LAYOUT.map(item => ({ ...item }));
	if (!seen.has("hazards")) {
		// Hazards must stay: make room by dropping the last tile if the dock is full.
		while (freeCells(layout) < 1 && layout.length) layout.pop();
		layout.push({ id: "hazards", span: 1 });
	}
	return layout;
}

/** Widgets that are not on the dock yet, in a steady order. */
export const availableWidgets = (layout: DockLayout): WidgetId[] => WIDGET_IDS.filter(id => !layout.some(item => item.id === id) && !WIDGETS[id].pinned);

/** A new tile starts at its smallest size. Null when even that does not fit. */
export function sizeThatFits(layout: DockLayout, id: WidgetId): number | null {
	const smallest = WIDGETS[id].sizes[0];
	return smallest <= freeCells(layout) ? smallest : null;
}

export function addWidget(layout: DockLayout, id: WidgetId): DockLayout {
	const span = sizeThatFits(layout, id);
	if (span === null || layout.some(item => item.id === id)) return layout;
	return [...layout, { id, span }];
}

export function removeWidget(layout: DockLayout, id: WidgetId): DockLayout {
	return WIDGETS[id].pinned ? layout : layout.filter(item => item.id !== id);
}

/** Moves a tile so it ends up at `index` in the list (0 is the far left). */
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
export function stepWidgetSize(layout: DockLayout, id: WidgetId, direction: 1 | -1): DockLayout {
	const item = layout.find(entry => entry.id === id);
	if (!item) return layout;
	const sizes = WIDGETS[id].sizes;
	const at = sizes.indexOf(item.span);
	const target = sizes[at + direction];
	if (target === undefined || (direction > 0 && target - item.span > freeCells(layout))) return layout;
	return layout.map(entry => (entry.id === id ? { ...entry, span: target } : entry));
}

export const canStep = (layout: DockLayout, id: WidgetId, direction: 1 | -1): boolean => stepWidgetSize(layout, id, direction) !== layout;

/** How close to an end of the dock a dragged tile has to get to count as "all the way", in cells. */
const END_MAGNET = 0.8;

/**
 * The layout while a tile is dragged: `leftCell` is where the tile's left edge is (in cells from the dock's left edge)
 * and `direction` which way it is moving. It trades places with a neighbour once it covers half of it: moving left
 * the left edge leads, moving right the right edge does. Getting within a little of an end of the dock snaps to that
 * end, so the first and last places are easy to reach without being exact. Returns the same layout when nothing changes.
 */
export function dragWidget(layout: DockLayout, id: WidgetId, leftCell: number, direction: 1 | -1): DockLayout {
	let current = layout;
	const at = (list: DockLayout) => list.findIndex(item => item.id === id);
	const span = layout[at(layout)]?.span;
	if (span === undefined) return layout;
	if (direction < 0 && leftCell < END_MAGNET) return moveWidget(layout, id, 0);
	if (direction > 0 && leftCell + span > DOCK_COLUMNS - END_MAGNET) return moveWidget(layout, id, layout.length - 1);
	for (let guard = 0; guard < layout.length; guard++) {
		const index = at(current);
		const starts = startColumns(current).map(column => column - 1);
		const before = current[index - 1], after = current[index + 1];
		if (direction < 0 && before && leftCell < starts[index - 1] + before.span / 2) current = moveWidget(current, id, index - 1);
		else if (direction > 0 && after && leftCell + span > starts[index + 1] + after.span / 2) current = moveWidget(current, id, index + 1);
		else break;
	}
	return current;
}
