import { useEffect, useRef } from "react";
import type mapboxgl from "mapbox-gl";
import { CLOSE_ZOOM, maxPitchFor, paddingFor, samePadding, setCameraPadding, setCameraPitch, type Insets } from "../lib/cameraPadding";
import type { CameraMode } from "../constants";

/**
 * Keeps the map's camera padding in step with what covers the screen, so the middle of the map (and with it the globe when
 * zoomed out, and the car when driving) is the middle of the space you can actually see: clear of a dock at the left or right
 * and, when zoomed out, of the status bar and the dock at the bottom.
 */
export function useCameraPadding(mapRef: React.RefObject<mapboxgl.Map | null>, loaded: boolean, cameraMode: CameraMode, hold?: React.RefObject<boolean>) {
	const insetsRef = useRef<Insets>({ top: 0, bottom: 0, left: 0, right: 0 });
	// The overview fits a route inside its own padding; leave that alone until the camera is following again.
	const paused = useRef(cameraMode === "overview");
	paused.current = cameraMode === "overview";
	const rerun = useRef<() => void>(() => {});
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !loaded) return;
		let frame = 0;
		let insets: Insets = insetsRef.current;
		const measure = () => {
			const bounds = map.getContainer().getBoundingClientRect();
			if (!bounds.height || !bounds.width) return;
			const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
			const top = rect("[data-top-overlay]");
			const dock = rect("[data-dock]");
			const side = rect("[data-dock-side]");
			const onLeft = !!side && side.left < bounds.left + bounds.width / 2;
			insets = {
				top: top ? Math.max(0, top.bottom - bounds.top) : 0,
				bottom: dock && dock.height > 0 ? Math.max(0, bounds.bottom - dock.top) : 0,
				left: side && onLeft ? Math.max(0, side.right - bounds.left) : 0,
				right: side && !onLeft ? Math.max(0, bounds.right - side.left) : 0,
			};
			insetsRef.current = insets;
		};
		const apply = () => {
			frame = 0;
			// A flight that carries its own padding (the globe showcase) is in charge until it ends: two writers made it flicker.
			if (hold?.current) return;
			const zoom = map.getZoom();
			// A route overview close in has fitted itself inside its own padding; leave it. Zoomed out it is the Earth, which is centred.
			if (paused.current && zoom >= CLOSE_ZOOM) return;
			const wanted = paddingFor(insets, zoom);
			if (!samePadding(map.getPadding(), wanted)) setCameraPadding(map, wanted);
			// Take the tilt out as the camera climbs, so the globe is square on and centred.
			const flatter = maxPitchFor(zoom);
			if (map.getPitch() > flatter + 0.2) setCameraPitch(map, flatter);
		};
		const schedule = () => { measure(); if (!frame) frame = requestAnimationFrame(apply); };
		rerun.current = schedule;
		const resize = new ResizeObserver(schedule);
		let observed: Element[] = [];
		const watch = () => {
			const elements = ["[data-top-overlay]", "[data-dock]", "[data-dock-side]"].map(selector => document.querySelector(selector)).filter((el): el is Element => !!el);
			if (elements.length === observed.length && elements.every((el, i) => el === observed[i])) return;
			resize.disconnect();
			resize.observe(map.getContainer());
			elements.forEach(el => resize.observe(el));
			observed = elements;
		};
		const mutations = new MutationObserver(() => { watch(); schedule(); });
		mutations.observe(document.body, { childList: true, subtree: true });
		// While zooming, change the padding and tilt in the same frame as the zoom (not a frame later), so they move together.
		const onZoom = () => apply();
		map.on("zoom", onZoom);
		// After a move only the padding needs applying again: what covers the map is measured when the page changes (above), and when
		// a transition or animation ends (a panel that slides without changing size). While following, the camera ends a move every
		// frame, and measuring then forced the page's layout inside the map's frame (up to 30 ms on the car computer).
		const afterMove = () => { if (!frame) frame = requestAnimationFrame(apply); };
		map.on("moveend", afterMove);
		document.addEventListener("transitionend", schedule, true);
		document.addEventListener("animationend", schedule, true);
		watch();
		// Straight away, before anything (the start-up flight) uses the camera.
		measure();
		apply();
		return () => { rerun.current = () => {}; mutations.disconnect(); resize.disconnect(); map.off("zoom", onZoom); map.off("moveend", afterMove); document.removeEventListener("transitionend", schedule, true); document.removeEventListener("animationend", schedule, true); if (frame) cancelAnimationFrame(frame); };
	}, [mapRef, loaded]);
	// Going back from the overview to following: put the padding back at once.
	useEffect(() => {
		if (cameraMode !== "overview") rerun.current();
	}, [cameraMode]);
	return {
		/** The padding the camera will have at this zoom, for flights to carry with them. */
		paddingAt: (zoom: number): Insets => paddingFor(insetsRef.current, zoom),
		/** Re-apply the padding now (after a flight that held it has ended or been interrupted). */
		refresh: () => rerun.current(),
	};
}
