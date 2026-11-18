/**
 * Where the sun is over the Earth right now, and how dark it is at any point, for the day and night sides of the globe.
 * Standard low-precision solar position (accurate to well under a degree, far more than a picture of the Earth needs).
 */
const RAD = Math.PI / 180;
const clampPlus = (x: number, max: number) => Math.max(-max, Math.min(max, x));
const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface Sun { /** Declination in degrees: the latitude the sun is directly over. */ declination: number; /** Longitude in degrees (-180 to 180) the sun is directly over. */ longitude: number }

export function sunPosition(date: Date): Sun {
	const days = date.getTime() / 86400000 - 10957.5; // days since J2000.0 (2000-01-01 12:00 UTC)
	const meanLongitude = (280.46 + 0.9856474 * days) % 360;
	const anomaly = ((357.528 + 0.9856003 * days) % 360) * RAD;
	const eclipticLongitude = (meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
	const obliquity = (23.439 - 0.0000004 * days) * RAD;
	const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
	const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
	const gmst = ((18.697374558 + 24.06570982441908 * days) % 24 + 24) % 24; // hours
	// The sun is over the longitude where the hour angle is zero.
	let longitude = rightAscension / RAD - gmst * 15;
	longitude = ((longitude + 540) % 360) - 180;
	return { declination: declination / RAD, longitude };
}

/** How high the sun is above the horizon at a place, in degrees (negative is below it). */
export function solarAltitude(latitude: number, longitude: number, sun: Sun): number {
	const lat = latitude * RAD, dec = sun.declination * RAD, hourAngle = (longitude - sun.longitude) * RAD;
	return Math.asin(clampPlus(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle), 1)) / RAD;
}

/** The darkest the night side gets; the Earth is never completely black, as city lights and the moon keep it faintly visible. */
const NIGHT_DARKNESS = 0.68;

/**
 * The shade to lay over a point on the globe, as red, green, blue and opacity (0 to 255). Clear in daylight, then through
 * twilight (the sun up to 18 degrees below the horizon) to the deep navy of night, with a thin warm glow along the edge where
 * the sun is just setting or rising.
 */
export function nightShade(altitude: number): [number, number, number, number] {
	const dark = NIGHT_DARKNESS * (1 - smoothstep(-16, 2, altitude)) ** 1.1;
	const glow = 0.24 * Math.exp(-(((altitude + 1.5) / 3.2) ** 2));
	const alpha = dark + glow * (1 - dark);
	if (alpha <= 0.002) return [0, 0, 0, 0];
	const night = [6, 14, 40], warm = [255, 128, 64];
	const weight = (glow * (1 - dark)) / alpha;
	const channel = (i: number) => Math.round(night[i] * (1 - weight) + warm[i] * weight);
	return [channel(0), channel(1), channel(2), Math.round(255 * alpha)];
}

/** How much of the city lights show at a place: none until the sun is well down, all of them once it is dark. */
export function lightsVisible(altitude: number): number {
	return 1 - smoothstep(-12, -3, altitude);
}

export const MERCATOR_LATITUDE = 85.0511287798;

/** Where the city lights may show, for the whole Earth, as a square Web Mercator picture: white, with the share of lights as its opacity. */
export function renderLightsMask(sun: Sun, size: number): Uint8ClampedArray<ArrayBuffer> {
	const out = new Uint8ClampedArray(size * size * 4);
	for (let row = 0; row < size; row++) {
		const latitude = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (row + 0.5)) / size))) * 180) / Math.PI;
		for (let col = 0; col < size; col++) {
			const at = (row * size + col) * 4;
			out[at] = 255; out[at + 1] = 255; out[at + 2] = 255;
			out[at + 3] = Math.round(255 * lightsVisible(solarAltitude(latitude, ((col + 0.5) / size) * 360 - 180, sun)));
		}
	}
	return out;
}

/** The night shade for the whole Earth as a square Web Mercator picture (the shape Mapbox draws on the globe), RGBA bytes. */
export function renderNightMask(sun: Sun, size: number): Uint8ClampedArray<ArrayBuffer> {
	const out = new Uint8ClampedArray(size * size * 4);
	for (let row = 0; row < size; row++) {
		const latitude = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (row + 0.5)) / size))) * 180) / Math.PI;
		for (let col = 0; col < size; col++) {
			const longitude = ((col + 0.5) / size) * 360 - 180;
			const [r, g, b, a] = nightShade(solarAltitude(latitude, longitude, sun));
			const at = (row * size + col) * 4;
			out[at] = r; out[at + 1] = g; out[at + 2] = b; out[at + 3] = a;
		}
	}
	return out;
}
