// Parses the common subset of OpenStreetMap opening_hours that Mapbox returns,
// e.g. "Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off" or "24/7".
// Anything we cannot read confidently yields null so the UI can stay quiet.

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY = 1440;
const SOON_MINUTES = 60;

/** Minutes after midnight. `end` may exceed 1440 for ranges that finish after midnight. */
export type DayRanges = [number, number][];
export type WeekSchedule = DayRanges[]; // index 0 = Sunday

export type OpenState = "open" | "closing-soon" | "closed" | "opening-soon" | "open-24h";
export interface OpenStatus { state: OpenState; label: string; /** Minutes until it closes (when open) or opens (when closed). */ minutes?: number }

function parseTime(text: string): number | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
	if (!match) return null;
	const minutes = Number(match[1]) * 60 + Number(match[2]);
	return Number(match[2]) < 60 && minutes <= DAY ? minutes : null;
}

function parseDays(spec: string): number[] | null {
	const days = new Set<number>();
	for (const part of spec.split(",")) {
		const [from, to] = part.trim().split("-").map(item => DAYS.indexOf(item.trim()));
		if (from < 0 || (part.includes("-") && to < 0)) return null;
		if (!part.includes("-")) { days.add(from); continue; }
		for (let day = from; ; day = (day + 1) % 7) { days.add(day); if (day === to) break; }
	}
	return days.size ? [...days] : null;
}

export function parseOpeningHours(text: string | undefined): WeekSchedule | null {
	if (!text?.trim()) return null;
	const week: WeekSchedule = Array.from({ length: 7 }, (): DayRanges => []);
	if (/^24\/7$/i.test(text.trim())) return week.map((): DayRanges => [[0, DAY]]);
	let parsed = false;
	for (const raw of text.split(";")) {
		const rule = raw.trim();
		if (!rule) continue;
		if (/\bPH\b|\bSH\b/.test(rule)) continue; // Public/school holiday overrides need a calendar.
		const match = /^((?:[A-Z][a-z](?:-[A-Z][a-z])?)(?:\s*,\s*[A-Z][a-z](?:-[A-Z][a-z])?)*)?\s*(.*)$/.exec(rule);
		if (!match) return null;
		const days = match[1] ? parseDays(match[1]) : [0, 1, 2, 3, 4, 5, 6];
		const times = match[2].trim();
		if (!days) return null;
		let ranges: DayRanges;
		if (/^(off|closed)$/i.test(times)) ranges = [];
		else if (/^24\/7$/i.test(times)) ranges = [[0, DAY]];
		else {
			ranges = [];
			for (const span of times.split(",")) {
				const [open, close] = span.split("-").map(item => parseTime(item));
				if (open == null || close == null || open === close) return null;
				ranges.push([open, close > open ? close : close + DAY]);
			}
		}
		for (const day of days) week[day] = ranges;
		parsed = true;
	}
	return parsed ? week : null;
}

/** Merge overlapping or touching intervals so a run across midnight reads as one opening. */
function mergedIntervals(week: WeekSchedule, weekday: number): [number, number][] {
	const intervals: [number, number][] = [];
	for (let offset = -1; offset <= 7; offset++)
		for (const [start, end] of week[(weekday + offset + 7) % 7]) intervals.push([offset * DAY + start, offset * DAY + end]);
	intervals.sort((a, b) => a[0] - b[0]);
	const merged: [number, number][] = [];
	for (const interval of intervals) {
		const last = merged[merged.length - 1];
		if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
		else merged.push([...interval]);
	}
	return merged;
}

export function formatClock(minutes: number): string {
	const wrapped = ((minutes % DAY) + DAY) % DAY;
	const hour = Math.floor(wrapped / 60), minute = wrapped % 60;
	const suffix = hour >= 12 ? "pm" : "am";
	return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function untilLabel(minutes: number): string {
	if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
	const hours = Math.floor(minutes / 60), rest = Math.round(minutes % 60);
	return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function openStatus(week: WeekSchedule | null, now: Date = new Date()): OpenStatus | null {
	if (!week) return null;
	const weekday = now.getDay();
	const current = now.getHours() * 60 + now.getMinutes();
	const intervals = mergedIntervals(week, weekday);
	const active = intervals.find(([start, end]) => start <= current && current < end);
	if (active) {
		if (active[1] - active[0] >= 7 * DAY) return { state: "open-24h", label: "Open 24 hours" };
		const left = active[1] - current;
		return left <= SOON_MINUTES
			? { state: "closing-soon", label: `Closing soon · ${formatClock(active[1])} (${untilLabel(left)})`, minutes: left }
			: { state: "open", label: `Open · Closes ${formatClock(active[1])}`, minutes: left };
	}
	const next = intervals.find(([start]) => start > current);
	if (!next) return { state: "closed", label: "Closed" };
	const wait = next[0] - current;
	const dayOffset = Math.floor(next[0] / DAY);
	const when = dayOffset === 0 ? formatClock(next[0]) : dayOffset === 1 ? `tomorrow ${formatClock(next[0])}` : `${DAY_NAMES[(weekday + dayOffset) % 7]} ${formatClock(next[0])}`;
	return wait <= SOON_MINUTES
		? { state: "opening-soon", label: `Opening soon · ${formatClock(next[0])} (${untilLabel(wait)})`, minutes: wait }
		: { state: "closed", label: `Closed · Opens ${when}`, minutes: wait };
}

export interface HoursRow { day: string; text: string; today: boolean }
export function weekRows(week: WeekSchedule, now: Date = new Date()): HoursRow[] {
	return [1, 2, 3, 4, 5, 6, 0].map(day => {
		const ranges = week[day];
		const text = !ranges.length ? "Closed" : ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === DAY ? "Open 24 hours"
			: ranges.map(([start, end]) => `${formatClock(start)} – ${formatClock(end)}`).join(", ");
		return { day: DAY_NAMES[day], text, today: day === now.getDay() };
	});
}

/**
 * What matters about the hours at the moment you will get there, not now.
 * Returns null when the arrival situation is unremarkable (open and staying open).
 */
export function arrivalStatus(week: WeekSchedule | null, now: Date, etaSeconds: number): OpenStatus | null {
	if (!week || !Number.isFinite(etaSeconds) || etaSeconds < 0) return null;
	const arrival = new Date(now.getTime() + etaSeconds * 1000);
	const [here, there] = [openStatus(week, now), openStatus(week, arrival)];
	if (!here || !there) return null;
	const time = formatClock(arrival.getHours() * 60 + arrival.getMinutes());
	if (there.state === "closed" || there.state === "opening-soon") return { state: "closed", label: `Closed when you arrive at ${time}` };
	if (there.state === "closing-soon") return { state: "closing-soon", label: `Closes ${untilLabel(there.minutes ?? 0)} after you arrive at ${time}`, minutes: there.minutes };
	if (here.state === "closed" || here.state === "opening-soon") return { state: "open", label: `Open when you arrive at ${time}`, minutes: there.minutes };
	return null;
}
