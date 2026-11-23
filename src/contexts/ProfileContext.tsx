import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { ipcRenderer } from "electron";
import { createProfile, deleteProfile, readProfiles, switchProfile, updateProfile, type Profile, type ProfileState } from "../lib/profiles";

interface ProfileContextValue {
	profiles: Profile[];
	active: Profile;
	switchTo: (id: string) => void;
	create: (name: string, avatar: string, color: string) => void;
	update: (id: string, patch: Partial<Pick<Profile, "name" | "avatar" | "color">>) => void;
	remove: (id: string) => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

const store = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
// Without storage there is one throwaway profile; nothing can be switched or saved.
const FALLBACK: ProfileState = { activeId: "driver", profiles: [{ id: "driver", name: "Driver", avatar: "🙂", color: "#2563eb" }] };

/**
 * Holds the driver profiles. Everything inside is remounted when the active profile changes, so every screen
 * and hook re-reads its settings from the newly loaded profile instead of needing to know about profiles.
 */
export function ProfileProvider({ children }: { children: React.ReactNode }) {
	const [state, setState] = useState<ProfileState>(() => { const s = store(); return s ? readProfiles(s) : FALLBACK; });
	const run = useCallback((change: (storage: Storage) => ProfileState) => { const s = store(); if (s) setState(change(s)); }, []);
	const value = useMemo<ProfileContextValue>(() => ({
		profiles: state.profiles,
		active: state.profiles.find(item => item.id === state.activeId) ?? state.profiles[0],
		switchTo: id => run(s => switchProfile(s, id)),
		create: (name, avatar, color) => run(s => createProfile(s, name, avatar, color)),
		update: (id, patch) => run(s => updateProfile(s, id, patch)),
		// The profile's explored map (kept in a file, not local storage) goes with it.
		remove: id => { run(s => deleteProfile(s, id)); void ipcRenderer.invoke("exploration:delete", id).catch((): void => undefined); },
	}), [state, run]);
	return <ProfileContext.Provider value={value}><React.Fragment key={state.activeId}>{children}</React.Fragment></ProfileContext.Provider>;
}

export function useProfiles(): ProfileContextValue {
	const value = useContext(ProfileContext);
	if (!value) throw new Error("useProfiles needs a ProfileProvider");
	return value;
}
