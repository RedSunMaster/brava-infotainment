export type AlertKind = "closure" | "incident" | "camera" | "hazard" | "delay" | "stale";
export interface RouteAlert { id: string; kind: AlertKind; severity: "error" | "warning" | "info"; title: string; detail?: string; /** How far ahead the closure or incident is, in metres. */ aheadM?: number }

interface Input {
	incidents?: { id: string; description: string; index: number }[];
	closures?: { start: number; end: number }[];
	/** Mapped speed cameras and hazards on the route; `index` is the route vertex. */
	hazards?: { id: string; kind: string; label: string; index: number; maxspeed?: string }[];
	trafficDelaySeconds?: number;
	/** Cumulative route distance in metres for each coordinate index. */
	meters: number[];
	position: number;
	stale?: boolean;
}

export function formatAhead(metres: number): string {
	if (metres < 100) return "just ahead";
	if (metres < 1000) return `${Math.round(metres / 50) * 50} m ahead`;
	return `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km ahead`;
}

function shorten(text: string, max = 44): string {
	const clean = text.replace(/\s+/g, " ").trim();
	return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Hazards further off than this are not worth a banner yet. */
export const HAZARD_ALERT_M = 1500;

/** Short, glanceable warnings about the rest of the route, most urgent first. */
export function buildRouteAlerts({ incidents = [], hazards = [], closures = [], trafficDelaySeconds = 0, meters, position, stale = false }: Input): RouteAlert[] {
	const here = meters[Math.min(position, meters.length - 1)] ?? 0;
	const ahead = (index: number) => Math.max(0, (meters[Math.min(index, meters.length - 1)] ?? here) - here);
	const alerts: RouteAlert[] = [];

	const closure = closures.filter(item => item.end >= position).sort((a, b) => a.start - b.start)[0];
	if (closure) alerts.push({
		id: `closure:${closure.start}`, kind: "closure", severity: "error",
		title: "Road closed", detail: closure.start <= position ? "on your route" : formatAhead(ahead(closure.start)), aheadM: ahead(closure.start),
	});

	const upcoming = incidents.filter(item => item.index >= position).sort((a, b) => a.index - b.index);
	if (upcoming.length) alerts.push({
		id: `incident:${upcoming[0].id}`, kind: "incident", severity: "warning",
		title: shorten(upcoming[0].description),
		detail: `${formatAhead(ahead(upcoming[0].index))}${upcoming.length > 1 ? ` · +${upcoming.length - 1} more` : ""}`, aheadM: ahead(upcoming[0].index),
	});

	const hazard = hazards.filter(item => item.index >= position).sort((a, b) => a.index - b.index).find(item => ahead(item.index) <= HAZARD_ALERT_M);
	if (hazard) {
		const camera = hazard.kind === "speed_camera" || hazard.kind === "red_light_camera";
		const maxspeed = hazard.maxspeed?.trim();
		const limit = maxspeed && /^\d{2,3}( ?(km\/h|mph))?$/.test(maxspeed) ? ` · ${maxspeed}` : "";
		alerts.push({ id: `hazard:${hazard.id}`, kind: camera ? "camera" : "hazard", severity: "warning", title: hazard.label, detail: `${formatAhead(ahead(hazard.index))}${limit}`, aheadM: ahead(hazard.index) });
	}

	if (trafficDelaySeconds >= 120) {
		const minutes = Math.round(trafficDelaySeconds / 60);
		alerts.push({ id: "delay", kind: "delay", severity: minutes >= 10 ? "error" : "warning", title: `Traffic +${minutes} min`, detail: "slower than usual" });
	}
	if (stale) alerts.push({ id: "stale", kind: "stale", severity: "info", title: "Traffic not updating", detail: "showing earlier conditions" });
	return alerts;
}
