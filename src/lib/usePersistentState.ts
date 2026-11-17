import { useEffect, useState } from "react";

/** useState that survives restarts: the value is kept in localStorage under `key` (falls back quietly if storage is unavailable). */
export function usePersistentState<T>(key: string, initial: T, valid: (value: unknown) => value is T): [T, React.Dispatch<React.SetStateAction<T>>] {
	const [value, setValue] = useState<T>(() => {
		try {
			const raw = localStorage.getItem(key);
			if (raw !== null) { const parsed: unknown = JSON.parse(raw); if (valid(parsed)) return parsed; }
		} catch { /* Use the default. */ }
		return initial;
	});
	useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep the value for this session. */ } }, [key, value]);
	return [value, setValue];
}

export const isNumberIn = (min: number, max: number) => (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
export const isBool = (value: unknown): value is boolean => typeof value === "boolean";
