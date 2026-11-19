export interface BluetoothDevice {
	mac: string;
	name: string;
	/** BlueZ icon hint, such as "audio-card", "audio-headset", "phone". */
	icon: string | null;
	paired: boolean;
	trusted: boolean;
	connected: boolean;
	rssi: number | null;
}
export interface BluetoothState {
	/** False off Linux, or when bluetoothctl is missing or BlueZ is not running. */
	available: boolean;
	powered: boolean;
	discovering: boolean;
	devices: BluetoothDevice[];
	error: string | null;
}
export type BluetoothAction = "pair" | "connect" | "disconnect" | "forget";
export interface BluetoothResult { ok: boolean; message: string }

export const MAC_PATTERN = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i;

function flag(text: string, key: string): boolean | null {
	const m = new RegExp(`^\\s*${key}:\\s*(yes|no)`, "im").exec(text);
	return m ? m[1].toLowerCase() === "yes" : null;
}
function field(text: string, key: string): string | null {
	const m = new RegExp(`^\\s*${key}:\\s*(.+)$`, "im").exec(text);
	return m ? m[1].trim() : null;
}

/** `bluetoothctl show` → adapter state. Null when there is no adapter. */
export function parseController(text: string): { powered: boolean; discovering: boolean } | null {
	if (!/^Controller /m.test(text)) return null;
	return { powered: flag(text, "Powered") === true, discovering: flag(text, "Discovering") === true };
}

/** `bluetoothctl devices` → MAC and name pairs. */
export function parseDeviceList(text: string): { mac: string; name: string }[] {
	const out: { mac: string; name: string }[] = [];
	for (const line of text.split("\n")) {
		const m = /^Device\s+([0-9A-F:]{17})\s+(.*)$/i.exec(line.trim());
		if (m) out.push({ mac: m[1].toUpperCase(), name: m[2].trim() });
	}
	return out;
}

/** `bluetoothctl info <mac>` → device details. */
export function parseDeviceInfo(mac: string, fallbackName: string, text: string): BluetoothDevice {
	const rssi = field(text, "RSSI");
	const parsedRssi = rssi ? Number.parseInt(rssi.replace(/^0x[0-9a-f]+\s*\(?/i, ""), 10) : NaN;
	return {
		mac,
		name: field(text, "Alias") ?? field(text, "Name") ?? fallbackName,
		icon: field(text, "Icon"),
		paired: flag(text, "Paired") === true,
		trusted: flag(text, "Trusted") === true,
		connected: flag(text, "Connected") === true,
		rssi: Number.isFinite(parsedRssi) ? parsedRssi : null,
	};
}

/** Nearby devices that never gave a name show their address as the name; they are noise in a list. */
export function isUnnamed(d: BluetoothDevice): boolean {
	return d.name.replace(/-/g, ":").toUpperCase() === d.mac;
}
