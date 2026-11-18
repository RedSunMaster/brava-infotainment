import { useEffect } from "react";
import loopUrl from "../assets/boot/matrice-loop.webm";

/** The opening screen stays up at least this long from the start of the page, and until the map is ready. */
const MIN_SPLASH_MS = 2400;
const FADE_MS = 1100;

/**
 * Runs the opening screen (the Matrice end frame in index.html, the same picture the boot splash ends on): starts its gentle loop video
 * on top of the still, then fades the whole screen out once the map is loaded and it has been up long enough.
 */
export function useSplash(ready: boolean) {
	// The loop's first frame is the still underneath, so it can start whenever the bundle gets here without a visible change. It is only
	// made visible once it is actually playing; with reduced motion asked for, the still simply stays.
	useEffect(() => {
		const splash = document.getElementById("splash");
		if (!splash || splash.querySelector("video")) return;
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
		const video = document.createElement("video");
		video.muted = true;
		video.loop = true;
		video.playsInline = true;
		video.setAttribute("aria-hidden", "true");
		video.style.opacity = "0";
		video.src = loopUrl;
		video.addEventListener("playing", () => { video.style.opacity = "1"; }, { once: true });
		video.addEventListener("error", () => video.remove(), { once: true });
		splash.appendChild(video);
		// Chromium will not start a video-only clip while the window is hidden (as it is for a moment at start-up), so try again
		// whenever the page becomes visible. Until it plays, the identical still underneath is what shows.
		const start = () => { if (video.isConnected && video.paused) video.play().catch(() => {}); };
		start();
		document.addEventListener("visibilitychange", start);
		return () => document.removeEventListener("visibilitychange", start);
	}, []);

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
