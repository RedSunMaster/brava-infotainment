import type { ExpressionSpecification } from "mapbox-gl";

type Coordinates = [number, number];
export function routeLineMetrics(coords: Coordinates[]) {
	const meters = [0], projected = [0];
	const mercator = ([lng, lat]: Coordinates) => [lng / 360, (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2];
	for (let i = 1; i < coords.length; i++) {
		const [a, b] = [coords[i - 1], coords[i]];
		const radians = Math.PI / 180;
		const h = Math.sin((b[1] - a[1]) * radians / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin((b[0] - a[0]) * radians / 2) ** 2;
		meters.push(meters[i - 1] + 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h))));
		const [p, q] = [mercator(a), mercator(b)];
		projected.push(projected[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
	}
	return { meters, projected };
}

export function routeLineProgress(metrics: ReturnType<typeof routeLineMetrics>, distance: number) {
	const { meters, projected } = metrics;
	const last = meters.length - 1;
	if (!last || !projected[last] || distance <= 0) return 0;
	if (distance >= meters[last]) return 1;
	let lo = 0, hi = last;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (meters[mid] <= distance) lo = mid; else hi = mid;
	}
	const fraction = (distance - meters[lo]) / (meters[hi] - meters[lo]);
	// GL JS line-progress uses projected length, while vehicle progress is in metres.
	return (projected[lo] + fraction * (projected[hi] - projected[lo])) / projected[last];
}

export function trafficGradient(projected: number[], congestion: string[] | undefined, base: string): string | ExpressionSpecification {
	const total = projected[projected.length - 1];
	if (!total || !congestion?.length) return base;
	const color = (level: string) => level === "moderate" ? "#f59e0b" : level === "heavy" ? "#ef4444" : level === "severe" ? "#991b1b" : base;
	const expression: ExpressionSpecification = ["step", ["line-progress"], color(congestion[0])];
	let previous = color(congestion[0]), lastStop = 0;
	for (let i = 1; i < projected.length - 1; i++) {
		const next = color(congestion[i]);
		const stop = projected[i] / total;
		if (next !== previous && stop > lastStop && stop < 1) {
			expression.push(stop, next);
			lastStop = stop;
			previous = next;
		}
	}
	return expression.length === 3 ? previous : expression;
}

/**
 * Thin a route to at most `max` points spaced evenly by distance, keeping both ends.
 * Search APIs take the route in the URL, so a full-resolution route fails with HTTP 414.
 */
export function sampleRoute(coords: Coordinates[], max = 150): Coordinates[] {
	if (coords.length <= max || max < 2) return coords.length <= max ? coords : [coords[0], coords[coords.length - 1]];
	const { meters } = routeLineMetrics(coords);
	const total = meters[meters.length - 1];
	if (!total) return [coords[0], coords[coords.length - 1]];
	const sampled: Coordinates[] = [coords[0]];
	let index = 0;
	for (let step = 1; step < max - 1; step++) {
		const target = (total * step) / (max - 1);
		while (index < coords.length - 1 && meters[index] < target) index++;
		if (coords[index] !== sampled[sampled.length - 1]) sampled.push(coords[index]);
	}
	sampled.push(coords[coords.length - 1]);
	return sampled;
}
