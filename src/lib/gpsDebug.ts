/** What the main process knows about gpsd, the receiver and its satellites, for the Settings → GPS tab. */
export interface GpsDebugDevice {
	path: string;
	driver: string | null;
	subtype: string | null;
	activated: string | null;
	bps: number | null;
	flags: number | null;
}
export interface GpsDebugSatellite {
	prn: number;
	/** gpsd constellation id: 0 GPS, 1 SBAS, 2 Galileo, 3 BeiDou, 5 QZSS, 6 GLONASS. */
	gnss: number | null;
	el: number | null;
	az: number | null;
	/** Signal strength, dB-Hz. */
	ss: number | null;
	used: boolean;
}
export interface GpsDebugSnapshot {
	daemon: "connecting" | "connected" | "offline";
	host: string;
	version: string | null;
	connectedSince: number | null;
	lastMessageAt: number | null;
	lastError: string | null;
	reconnects: number;
	messageCounts: Record<string, number>;
	devices: GpsDebugDevice[];
	tpv: {
		mode: number;
		time: string | null;
		lat: number | null;
		lon: number | null;
		alt: number | null;
		speed: number | null;
		track: number | null;
		climb: number | null;
		epx: number | null;
		epy: number | null;
		epv: number | null;
		eps: number | null;
		device: string | null;
		receivedAt: number;
	} | null;
	sky: {
		satellites: GpsDebugSatellite[];
		hdop: number | null;
		vdop: number | null;
		pdop: number | null;
		device: string | null;
		receivedAt: number;
	} | null;
}

export const GNSS_NAMES: Record<number, string> = { 0: "GPS", 1: "SBAS", 2: "Galileo", 3: "BeiDou", 4: "IMES", 5: "QZSS", 6: "GLONASS", 7: "NavIC" };
export function gnssName(id: number | null): string { return id === null ? "GPS" : (GNSS_NAMES[id] ?? `GNSS ${id}`); }
