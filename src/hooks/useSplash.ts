import { useEffect } from "react";

/** The opening screen stays up at least this long from the start of the page, and until the map is ready. */
const MIN_SPLASH_MS = 2400;
const FADE_MS = 1100;

/** Fades out the opening screen (the logo in index.html) once the map is loaded and it has been up long enough. */
export function useSplash(ready: boolean) {
	useEffect(() => {
		if (!ready) return;
		const splash = document.getElementById("splash");
		if (!splash) return;
		const timers: number[] = [];
		timers.push(window.setTimeout(() => {
			splash.classList.add("done");
			timers.push(window.setTimeout(() => splash.remove(), FADE_MS + 100));
		}, Math.max(0, MIN_SPLASH_MS - performance.now())));
		return () => timers.forEach(timer => window.clearTimeout(timer));
	}, [ready]);
}
