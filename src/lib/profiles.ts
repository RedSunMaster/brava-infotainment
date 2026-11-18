/**
 * Driver profiles. Every setting the app keeps under a "brava-" or "brava." key (climate, favourites, saved
 * places, voice, route and map choices, theme, and anything added later) belongs to the active profile. Switching
 * stores the active profile's values, clears them, and loads the next profile's, so each driver finds the car as
 * they left it. The Spotify account (its tokens are not "brava-" keys, and the refresh token lives in the main process),
 * the music player set-up, and the profile list itself are shared and never swapped.
 */
export interface Profile { id: string; name: string; avatar: string; color: string }
export interface ProfileState { activeId: string; profiles: Profile[] }

export type StorageLike = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

export const AVATARS = ["🙂", "😎", "👩", "👨", "🧑", "🧒", "👵", "👴", "🐶", "🦊", "🏎️", "🌟"] as const;
export const COLOURS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#9333ea", "#0891b2", "#db2777", "#64748b"] as const;
export const MAX_PROFILES = 8;
export const MAX_NAME = 16;

const PROFILES_KEY = "brava-profiles";
const DATA_PREFIX = "brava-profile-data:";
/** Settings that describe the car or the Spotify account rather than the driver, so every profile sees the same ones. */
export const SHARED_KEYS: readonly string[] = [PROFILES_KEY, "brava-spotify-volume", "brava-inapp-player", "brava-resume-music"];
const isScoped = (key: string) => (key.startsWith("brava-") || key.startsWith("brava.")) && !SHARED_KEYS.includes(key) && !key.startsWith(DATA_PREFIX);

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const cleanName = (name: string): string => name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);

function validProfile(item: unknown): item is Profile {
	const p = item as Profile | null;
	return !!p && typeof p.id === "string" && p.id.length > 0 && typeof p.name === "string" && cleanName(p.name).length > 0 && typeof p.avatar === "string" && typeof p.color === "string";
}

function write(storage: StorageLike, state: ProfileState): ProfileState {
	try { storage.setItem(PROFILES_KEY, JSON.stringify(state)); } catch { /* Kept for this session only. */ }
	return state;
}

/** The saved profiles. First run makes one "Driver" profile that simply adopts the settings already on this device. */
export function readProfiles(storage: StorageLike): ProfileState {
	try {
		const data = JSON.parse(storage.getItem(PROFILES_KEY) ?? "null") as Partial<ProfileState> | null;
		const profiles = Array.isArray(data?.profiles) ? data.profiles.filter(validProfile).slice(0, MAX_PROFILES) : [];
		if (profiles.length) return { profiles, activeId: profiles.some(item => item.id === data?.activeId) ? data!.activeId! : profiles[0].id };
	} catch { /* Start fresh. */ }
	const first: Profile = { id: newId(), name: "Driver", avatar: AVATARS[0], color: COLOURS[0] };
	return write(storage, { profiles: [first], activeId: first.id });
}

function scopedKeys(storage: StorageLike): string[] {
	const keys: string[] = [];
	for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key && isScoped(key)) keys.push(key); }
	return keys;
}

function stash(storage: StorageLike, id: string): void {
	const snapshot: Record<string, string> = {};
	for (const key of scopedKeys(storage)) { const value = storage.getItem(key); if (value !== null) snapshot[key] = value; }
	try { storage.setItem(DATA_PREFIX + id, JSON.stringify(snapshot)); } catch { /* Out of space: the next profile still loads. */ }
}

function load(storage: StorageLike, id: string): void {
	for (const key of scopedKeys(storage)) storage.removeItem(key);
	try {
		const snapshot = JSON.parse(storage.getItem(DATA_PREFIX + id) ?? "{}") as Record<string, unknown>;
		for (const [key, value] of Object.entries(snapshot)) if (isScoped(key) && typeof value === "string") storage.setItem(key, value);
	} catch { /* A damaged snapshot loads as defaults. */ }
}

/** Makes `toId` the active profile, keeping the current one's settings for next time. */
export function switchProfile(storage: StorageLike, toId: string): ProfileState {
	const state = readProfiles(storage);
	if (toId === state.activeId || !state.profiles.some(item => item.id === toId)) return state;
	stash(storage, state.activeId);
	load(storage, toId);
	return write(storage, { ...state, activeId: toId });
}

export function createProfile(storage: StorageLike, name: string, avatar: string, color: string): ProfileState {
	const state = readProfiles(storage);
	const clean = cleanName(name);
	if (!clean || state.profiles.length >= MAX_PROFILES) return state;
	return write(storage, { ...state, profiles: [...state.profiles, { id: newId(), name: clean, avatar, color }] });
}

export function updateProfile(storage: StorageLike, id: string, patch: Partial<Pick<Profile, "name" | "avatar" | "color">>): ProfileState {
	const state = readProfiles(storage);
	const name = patch.name === undefined ? undefined : cleanName(patch.name);
	if (name === "") return state;
	return write(storage, { ...state, profiles: state.profiles.map(item => item.id === id ? { ...item, ...patch, ...(name ? { name } : {}) } : item) });
}

/** Removes a profile and its saved settings. The active profile and the last one cannot be removed. */
export function deleteProfile(storage: StorageLike, id: string): ProfileState {
	const state = readProfiles(storage);
	if (id === state.activeId || state.profiles.length < 2 || !state.profiles.some(item => item.id === id)) return state;
	try { storage.removeItem(DATA_PREFIX + id); } catch { /* The profile is gone from the list either way. */ }
	return write(storage, { ...state, profiles: state.profiles.filter(item => item.id !== id) });
}
