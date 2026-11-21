import { useEffect, useSyncExternalStore } from "react";
import { chimeDue, createNotificationStore, parsePhoneMessage, type StoredNotification } from "../lib/phoneLink";
import { audioDucking } from "../lib/audioDucking";
import { playChime } from "../lib/notificationChime";
import { voiceLevels } from "./useMasterVolume";
import { createPhoneSettings } from "../lib/phoneSettings";

/** What the main process reports about the connection to the phone (see phoneLinkMain.ts). */
export interface PhoneLinkState { connected: boolean; device: string | null; transport: "tcp" | "bluetooth" | null; lastSeen: number | null }

interface ElectronPhone {
	getState(): Promise<PhoneLinkState>;
	dismiss(key: string): void;
	onState(cb: (state: PhoneLinkState) => void): () => void;
	onMessage(cb: (message: unknown) => void): () => void;
}
const bridge = (): ElectronPhone | null => (typeof window === "undefined" ? null : ((window as unknown as { electronPhone?: ElectronPhone }).electronPhone ?? null));
const storage = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

/** How long a pop-up stays over the map. */
const TOAST_MS = 7000;
const SEEN_KEY = "brava-phone-seen";

export const phoneSettings = createPhoneSettings(storage());
export const phoneNotifications = createNotificationStore({ isAllowed: phoneSettings.isAllowed });

// ── Shared state, outside React so every part of the screen sees the same thing ──
let link: PhoneLinkState = { connected: false, device: null, transport: null, lastSeen: null };
let toast: StoredNotification | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };

function setToast(next: StoredNotification | null) {
	if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
	toast = next;
	if (next) toastTimer = setTimeout(() => { toast = null; toastTimer = null; emit(); }, TOAST_MS);
	emit();
}

function markSeen() { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* Not remembered. */ } }
const seen = (): boolean => { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; } };

let lastChime: number | null = null;

let started = false;
function start() {
	const electron = bridge();
	if (started || !electron) return;
	started = true;
	void electron.getState().then((state) => { link = state; if (state.connected) markSeen(); emit(); }).catch((): void => undefined);
	electron.onState((state) => { link = state; if (state.connected) markSeen(); emit(); });
	electron.onMessage((raw) => {
		// The main process has already checked it; checking again costs nothing and keeps this safe on its own.
		const message = parsePhoneMessage(JSON.stringify(raw));
		if (!message) return;
		if (message.t === "notif") {
			phoneSettings.noteApp(message.app, message.appName);
			const stored = phoneNotifications.add(message);
			if (stored) {
				setToast(stored);
				const now = Date.now();
				const level = voiceLevels.get().chime;
				if (chimeDue({ muted: phoneSettings.get().chimeMuted, level, ducked: audioDucking.ducked, time: stored.time, now, lastChime })) { lastChime = now; playChime(level); }
			}
		} else if (message.t === "gone") {
			phoneNotifications.remove(message.key);
			if (toast?.key === message.key) setToast(null);
		}
	});
}

export function usePhoneLink() {
	useEffect(() => { start(); phoneSettings.reload(); }, []);
	const connection = useSyncExternalStore(subscribe, () => link, () => link);
	const popup = useSyncExternalStore(subscribe, () => toast, () => toast);
	const list = useSyncExternalStore(phoneNotifications.subscribe, phoneNotifications.get, phoneNotifications.get);
	const settings = useSyncExternalStore(phoneSettings.subscribe, phoneSettings.get, phoneSettings.get);
	return {
		/** False on a computer with no phone link at all (such as a development PC). */
		available: bridge() !== null,
		/** Worth showing in the status bar: connected now, or connected at some time before. */
		visible: bridge() !== null && (connection.connected || seen()),
		connection,
		items: list.items,
		unread: list.unread,
		toast: popup,
		settings,
		dismissToast: () => setToast(null),
		markAllRead: phoneNotifications.markAllRead,
		/** Removes it here, and on the phone. */
		dismiss(key: string) { phoneNotifications.remove(key); if (toast?.key === key) setToast(null); bridge()?.dismiss(key); },
		clearAll() { phoneNotifications.get().items.forEach((item) => bridge()?.dismiss(item.key)); phoneNotifications.clear(); setToast(null); },
		setToasts: phoneSettings.setToasts,
		setShowText: phoneSettings.setShowText,
		setChimeMuted: phoneSettings.setChimeMuted,
		setBlocked: phoneSettings.setBlocked,
	};
}
