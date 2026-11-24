import type { LngLat } from "./exploration";

/**
 * The dots layer places things in metres east and north of an anchor near the view, then lets the map turn those metres
 * into its Mercator coordinates (one scale for the whole layer, from the anchor's latitude). That only comes out right if
 * the metres are the map's own: Mercator metres, which stretch with latitude the same way east-west and north-south, so a
 * degree of latitude is as long as a degree of longitude at the equator, 111,319.49 m, wherever it is. (Using the ground
 * distance of a degree of latitude, 110,540 m at the equator and 111,150 m at Christchurch, put things out in proportion to
 * their distance from the anchor: several metres at the edge of the view.)
 *
 * Pure logic with no map, so it can be tested on its own.
 */
export const MERCATOR_M_PER_DEGREE = 111_319.49;

/** Mercator metres east and north of `anchor` that `pos` is, to a good approximation over a few kilometres. */
export function toLocalMetres(anchor: LngLat, pos: LngLat): [number, number] {
	return [(pos[0] - anchor[0]) * MERCATOR_M_PER_DEGREE * Math.cos((anchor[1] * Math.PI) / 180), (pos[1] - anchor[1]) * MERCATOR_M_PER_DEGREE];
}
