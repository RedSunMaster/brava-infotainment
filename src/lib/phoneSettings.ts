/** What the driver has chosen about phone notifications. Kept per driver profile (a "brava-" key). */
export interface PhoneSettings {
	/** Pop up a card over the map when a notification arrives. */
	toasts: boolean;
	/** Show the text of a notification on that pop-up (off hides it from passengers: only the sender shows). */
	showText: boolean;
	/** Silences the sound played when a notification arrives (its volume is the "chime" level). */
	chimeMuted: boolean;
	/** Apps (Android package names) whose notifications are ignored. */
	blocked: string[];
	/** Apps seen so far, so one can be switched off even when it has nothing showing right now. */
	apps: Record<string, string>;
}
type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const PHONE_SETTINGS_KEY = "brava-phone-settings";
/** A phone that sends hundreds of different apps cannot grow this without limit. */
const MAX_APPS = 100;
export const DEFAULT_PHONE_SETTINGS: PhoneSettings = { toasts: true, showText: true, chimeMuted: false, blocked: [], apps: {} };

export function readPhoneSettings(storage: StorageLike | null): PhoneSettings {
	try {
		const raw: unknown = JSON.parse(storage?.getItem(PHONE_SETTINGS_KEY) ?? "null");
		if (!raw || typeof raw !== "object") return { ...DEFAULT_PHONE_SETTINGS, blocked: [], apps: {} };
		const r = raw as Record<string, unknown>;
		const apps: Record<string, string> = {};
		if (r.apps && typeof r.apps === "object") for (const [key, value] of Object.entries(r.apps as Record<string, unknown>).slice(0, MAX_APPS)) if (typeof value === "string") apps[key] = value.slice(0, 80);
		return {
			toasts: typeof r.toasts === "boolean" ? r.toasts : true,
			showText: typeof r.showText === "boolean" ? r.showText : true,
			chimeMuted: typeof r.chimeMuted === "boolean" ? r.chimeMuted : false,
			blocked: Array.isArray(r.blocked) ? r.blocked.filter((item): item is string => typeof item === "string").slice(0, MAX_APPS) : [],
			apps,
		};
	} catch {
		return { ...DEFAULT_PHONE_SETTINGS, blocked: [], apps: {} };
	}
}

export function createPhoneSettings(storage: StorageLike | null) {
	let state = readPhoneSettings(storage);
	const listeners = new Set<() => void>();
	const commit = (next: PhoneSettings) => {
		state = next;
		try { storage?.setItem(PHONE_SETTINGS_KEY, JSON.stringify(state)); } catch { /* Kept for this session only. */ }
		listeners.forEach((listener) => listener());
	};
	return {
		get: () => state,
		subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); },
		isAllowed: (app: string) => !state.blocked.includes(app),
		setToasts: (toasts: boolean) => commit({ ...state, toasts }),
		setShowText: (showText: boolean) => commit({ ...state, showText }),
		setChimeMuted: (chimeMuted: boolean) => commit({ ...state, chimeMuted }),
		setBlocked(app: string, blocked: boolean): void {
			const rest = state.blocked.filter((item) => item !== app);
			commit({ ...state, blocked: blocked ? [...rest, app] : rest });
		},
		/** Remembers an app's name the first time it is seen (and when it is renamed). */
		noteApp(app: string, name: string): void {
			if (!app || state.apps[app] === name) return;
			if (!(app in state.apps) && Object.keys(state.apps).length >= MAX_APPS) return;
			commit({ ...state, apps: { ...state.apps, [app]: name } });
		},
		/** Re-reads from storage, for when the active driver profile changes. */
		reload(): void { state = readPhoneSettings(storage); listeners.forEach((listener) => listener()); },
	};
}
