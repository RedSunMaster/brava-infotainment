/**
 * The phone link: notifications from the driver's phone, sent by the Brava Phone Link Android app.
 *
 * Messages are single lines of JSON ("JSON lines"), UTF-8, one message per line, so the same format works over Bluetooth
 * (RFCOMM) and over the TCP link used for development. Everything received is untrusted input: it is checked and cut to a
 * sensible size here before anything else sees it.
 *
 *   phone → car   {"t":"hello","v":1,"device":"Pixel 9"}
 *                 {"t":"notif","key":"…","app":"com.google.android.apps.messaging","appName":"Messages","title":"Sam","text":"Running late","sender":"Sam","conversation":null,"kind":"message","time":1760000000000}
 *                 {"t":"gone","key":"…"}        the notification was dismissed on the phone
 *                 {"t":"ping"}
 *   car → phone   {"t":"dismiss","key":"…"}     the driver dismissed it on the car screen
 *                 {"t":"pong"}
 */
export const PROTOCOL_VERSION = 1;
/** A line longer than this is dropped; it is far more than any real notification needs. */
export const MAX_LINE = 32 * 1024;

export interface PhoneNotification {
	key: string;
	/** Android package name of the app that posted it. */
	app: string;
	appName: string;
	title: string;
	text: string;
	/** Who sent it, for messages. */
	sender: string | null;
	/** The chat or group, when it is not the same as the sender. */
	conversation: string | null;
	kind: "message" | "other";
	/** Milliseconds since 1970, as stamped by the phone. */
	time: number;
}

export type PhoneMessage =
	| { t: "hello"; v: number; device: string }
	| ({ t: "notif" } & PhoneNotification)
	| { t: "gone"; key: string }
	| { t: "ping" };

export type CarMessage = { t: "dismiss"; key: string } | { t: "pong" };

const LIMITS = { key: 300, app: 200, appName: 80, title: 200, text: 1000, sender: 100, conversation: 150, device: 80 } as const;

function text(value: unknown, max: number): string {
	// Control characters (other than ordinary spacing) have no business in a notification.
	// eslint-disable-next-line no-control-regex
	return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, max) : "";
}
function optional(value: unknown, max: number): string | null {
	const cleaned = text(value, max).trim();
	return cleaned ? cleaned : null;
}

/** Reads one line from the phone. Returns null for anything that is not a well-formed, known message. */
export function parsePhoneMessage(line: string, now: number = Date.now()): PhoneMessage | null {
	if (line.length > MAX_LINE) return null;
	let data: unknown;
	try { data = JSON.parse(line); } catch { return null; }
	if (!data || typeof data !== "object") return null;
	const m = data as Record<string, unknown>;
	switch (m.t) {
		case "hello": {
			const v = typeof m.v === "number" && Number.isFinite(m.v) ? Math.trunc(m.v) : 0;
			return v >= 1 ? { t: "hello", v, device: text(m.device, LIMITS.device).trim() || "Phone" } : null;
		}
		case "ping": return { t: "ping" };
		case "gone": {
			const key = text(m.key, LIMITS.key);
			return key ? { t: "gone", key } : null;
		}
		case "notif": {
			const key = text(m.key, LIMITS.key);
			if (!key) return null;
			const time = typeof m.time === "number" && Number.isFinite(m.time) && m.time > 0 ? Math.trunc(m.time) : now;
			return {
				t: "notif",
				key,
				app: text(m.app, LIMITS.app),
				appName: text(m.appName, LIMITS.appName).trim() || text(m.app, LIMITS.appName),
				title: text(m.title, LIMITS.title),
				text: text(m.text, LIMITS.text),
				sender: optional(m.sender, LIMITS.sender),
				conversation: optional(m.conversation, LIMITS.conversation),
				kind: m.kind === "message" ? "message" : "other",
				// A phone with a wrong clock must not put a notification in the future.
				time: Math.min(time, now),
			};
		}
		default: return null;
	}
}

export function frame(message: CarMessage): string { return JSON.stringify(message) + "\n"; }

/** Turns arriving chunks of bytes-as-text into whole lines. Overlong lines are skipped, not buffered without limit. */
export function createLineSplitter(onLine: (line: string) => void, maxLine: number = MAX_LINE) {
	let buffer = "";
	let skipping = false;
	return (chunk: string) => {
		buffer += chunk;
		for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
			const line = buffer.slice(0, end).replace(/\r$/, "");
			buffer = buffer.slice(end + 1);
			if (skipping) skipping = false;
			else if (line.length <= maxLine && line.trim()) onLine(line);
		}
		if (buffer.length > maxLine) { buffer = ""; skipping = true; }
	};
}

export interface StoredNotification extends PhoneNotification { read: boolean }
export interface NotificationState { items: StoredNotification[]; unread: number }

/** The newest-first list of what has arrived, leaving out apps the driver has switched off. */
export function createNotificationStore(options: { max?: number; isAllowed?: (app: string) => boolean } = {}) {
	const max = options.max ?? 50;
	let items: StoredNotification[] = [];
	let state: NotificationState = { items, unread: 0 };
	const listeners = new Set<() => void>();
	const commit = () => { state = { items, unread: items.filter((item) => !item.read).length }; listeners.forEach((listener) => listener()); };
	return {
		get: () => state,
		subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); },
		/** Adds or updates (the same key again is an edited notification, such as a new message in a chat). Returns the stored one, or null if the app is not allowed. */
		add(notification: PhoneNotification): StoredNotification | null {
			if (options.isAllowed && !options.isAllowed(notification.app)) return null;
			const stored: StoredNotification = { ...notification, read: false };
			items = [stored, ...items.filter((item) => item.key !== notification.key)].sort((a, b) => b.time - a.time).slice(0, max);
			commit();
			return stored;
		},
		remove(key: string): void {
			if (!items.some((item) => item.key === key)) return;
			items = items.filter((item) => item.key !== key);
			commit();
		},
		markAllRead(): void {
			if (!items.some((item) => !item.read)) return;
			items = items.map((item) => ({ ...item, read: true }));
			commit();
		},
		clear(): void { if (items.length) { items = []; commit(); } },
	};
}
export type NotificationStore = ReturnType<typeof createNotificationStore>;

/** How long ago, in the few words a glance needs: "now", "5 min", "2 h", then the day. */
export function timeAgo(time: number, now: number = Date.now()): string {
	const minutes = Math.max(0, Math.floor((now - time) / 60_000));
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} h`;
	return new Date(time).toLocaleDateString("en-NZ", { weekday: "short" });
}

/** What the voice says when the driver taps Read on a notification. Links and pictures are not read out. */
export function spokenNotification(n: PhoneNotification): string {
	const clean = (value: string) => value
		.replace(/https?:\/\/\S+/gi, "a link")
		.replace(/\p{Extended_Pictographic}|\u200d|\ufe0f/gu, "")
		.replace(/\s+/g, " ")
		.trim();
	const text = clean(n.text);
	if (n.kind === "message") {
		const who = clean(n.sender ?? n.title) || "Someone";
		const group = n.conversation ? clean(n.conversation) : "";
		const from = group && group !== who ? `${who} in ${group}` : who;
		return text ? `Message from ${from}: ${text}` : `Message from ${from}.`;
	}
	const title = clean(n.title);
	return [clean(n.appName), [title, text].filter(Boolean).join(". ")].filter(Boolean).join(": ");
}
