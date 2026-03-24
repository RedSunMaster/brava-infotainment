export type TimeOfDay = "dawn" | "day" | "dusk" | "night";

// Hour ranges (24h) → time of day
const TIME_RANGES: { range: [number, number]; period: TimeOfDay }[] = [
	{ range: [5, 9], period: "dawn" },
	{ range: [9, 17], period: "day" },
	{ range: [17, 20], period: "dusk" },
	{ range: [20, 24], period: "night" },
	{ range: [0, 5], period: "night" },
];

const TIME_OF_DAY_VALUES: TimeOfDay[] = ["dawn", "day", "dusk", "night"];

export function getTimeOfDay(hour = new Date().getHours()): TimeOfDay {
	if (process.env.NODE_ENV === "development") {
		const param = new URLSearchParams(window.location.search).get("tod");
		if (TIME_OF_DAY_VALUES.includes(param as TimeOfDay)) {
			return param as TimeOfDay;
		}
	}

	return (
		TIME_RANGES.find(({ range: [start, end] }) => hour >= start && hour < end)
			?.period ?? "day"
	);
}

export function getStyleForPeriod(period: TimeOfDay): string {
	const base = {
		dawn: process.env.MAPBOX_STYLE_DAWN,
		day: process.env.MAPBOX_STYLE_DAY,
		dusk: process.env.MAPBOX_STYLE_DUSK,
		night: process.env.MAPBOX_STYLE_NIGHT,
	}[period];
	return `${base}?optimize=true`; // ✅
}

export function getCurrentStyle(): string {
	return getStyleForPeriod(getTimeOfDay());
}
