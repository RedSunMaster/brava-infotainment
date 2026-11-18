import { useEffect, useRef } from "react";
import type mapboxgl from "mapbox-gl";
import { ZOOM_LEVEL } from "../constants";
import { puckOffset } from "../lib/cameraPadding";
import { driftClouds } from "../lib/mapStyle";
import { CLOUD_DRIFT_DEG_PER_S, GLOBE_LATITUDE, GLOBE_ZOOM, SPIN_STEP_MS, idleLongEnough, nextSpinCentre } from "../lib/showcase";

type Phase = "waiting" | "globe" | "approaching" | "local" | "leaving" | "grabbed" | "manual";
const APPROACH_MS = 8000;
const LEAVE_MS = 6000;

interface Options {
	mapRef: React.RefObject<mapboxgl.Map | null>;
	mapLoaded: boolean;
	/** The setting: show the turning globe at start and when idle. Off means the camera flies straight to the car at start, as before. */
	enabled: boolean;
	/** There is a position to fly to (a GPS fix, or the simulated one in a preview). */
	hasPosition: boolean;
	positionRef: React.RefObject<[number, number]>;
	bearingRef: React.RefObject<number>;
	mapOffset: React.RefObject<number>;
	/** The follow camera stands aside while the globe turns or the camera is flying. */
	cameraTransitionRef: React.RefObject<boolean>;
	/** The driver is using destinations, or the car is moving: come down to the car. */
	wantsLocal: boolean;
	/** Nothing is going on: parked, no route, no panels open. */
	parked: boolean;
}

/**
 * The idle globe. At start the Earth turns slowly in space, with its clouds drifting over it. When the driver uses destinations or the
 * car moves, the camera flies down to the car. Once parked and left alone for a few minutes it flies back up and turns again.
 * Touching the map yourself takes over; the usual recentring brings the camera back to the car afterwards.
 */
export function useGlobeShowcase(options: Options) {
	const latest = useRef(options);
	latest.current = options;
	const phase = useRef<Phase>("waiting");
	const generation = useRef(0);
	const parkedSince = useRef<number | null>(null);
	const lastActivity = useRef(Date.now());
	const controls = useRef<{ approach: () => void; approachIfAway: () => boolean; startGlobe: () => void } | null>(null);

	useEffect(() => {
		const map = options.mapRef.current;
		if (!map || !options.mapLoaded) return;
		const transition = (on: boolean) => { latest.current.cameraTransitionRef.current = on; };

		function startGlobe() {
			const my = ++generation.current;
			phase.current = "globe";
			transition(true);
			const spin = () => {
				if (my !== generation.current || phase.current !== "globe") return;
				// One smooth, straight-line move a step round the world; when it ends, the next. West, so the Earth turns eastward.
				map!.easeTo({ center: nextSpinCentre(map!.getCenter().lng), zoom: GLOBE_ZOOM, pitch: 0, bearing: 0, duration: SPIN_STEP_MS, easing: (t) => t, essential: true });
				map!.once("moveend", spin);
			};
			spin();
		}

		function approach() {
			const o = latest.current;
			if (!o.hasPosition) return;
			const my = ++generation.current;
			phase.current = "approaching";
			transition(true);
			map!.flyTo({
				center: o.positionRef.current, zoom: ZOOM_LEVEL, pitch: 45, bearing: o.bearingRef.current,
				offset: puckOffset(map!, 0.2), duration: APPROACH_MS,
				// Without this Mapbox skips the flight when the system has reduced motion on (Windows "Show animations" off, remote
				// sessions, kiosks). The flight is part of the product, so it always runs.
				essential: true,
			});
			let done = false;
			const finish = () => {
				if (done || my !== generation.current) return;
				done = true;
				window.clearTimeout(safety);
				map!.off("moveend", finish);
				// The flight's own offset is not reliable (it can end with the car at the screen centre), so set the resting camera
				// explicitly: the car where the open or closed panels say it belongs.
				map!.easeTo({ center: latest.current.positionRef.current, offset: puckOffset(map!, latest.current.mapOffset.current), duration: 0 });
				transition(false);
				phase.current = "local";
			};
			// If the flight is interrupted or never reports its end, do not leave the camera stuck in transition.
			const safety = window.setTimeout(finish, APPROACH_MS + 1500);
			// Registered after flyTo, which first ends whatever the camera was doing and would otherwise trigger this at once.
			map!.once("moveend", finish);
		}

		function leave() {
			const o = latest.current;
			const my = ++generation.current;
			phase.current = "leaving";
			transition(true);
			map!.flyTo({ center: [o.positionRef.current[0], GLOBE_LATITUDE], zoom: GLOBE_ZOOM, pitch: 0, bearing: 0, offset: [0, 0], duration: LEAVE_MS, essential: true });
			map!.once("moveend", () => { if (my === generation.current) startGlobe(); });
		}

		const approachIfAway = (): boolean => {
			const away = phase.current === "globe" || phase.current === "leaving" || phase.current === "grabbed" || (phase.current === "manual" && map.getZoom() < 6);
			if (!away || !latest.current.hasPosition) return false;
			approach();
			return true;
		};
		controls.current = { approach, approachIfAway, startGlobe };

		// The driver takes the camera: stop turning and flying, and let the usual map handling carry on.
		const manual = () => {
			if (phase.current === "globe" || phase.current === "approaching" || phase.current === "leaving" || phase.current === "grabbed") {
				generation.current++;
				phase.current = "manual";
				transition(false);
			}
		};
		const onUserZoom = (event: { originalEvent?: unknown }) => { if (event.originalEvent) manual(); };
		map.on("dragstart", manual);
		map.on("zoomstart", onUserZoom);
		map.on("rotatestart", onUserZoom);
		map.on("pitchstart", onUserZoom);
		// The moment a finger (or the wheel) touches the map, the turn or flight in progress stops, before the map's own gesture handling
		// starts: otherwise the animation would carry on under the finger and the driver could not move the globe.
		const canvas = map.getCanvas();
		// A touch that turns out to be a swipe or a pinch hands the camera to the driver. A tap that does nothing (no drag, and no destination
		// picked) carries on with whatever was happening, so touching the globe does not leave it frozen.
		let resumeTimer: number | undefined;
		const grab = () => {
			const was = phase.current;
			if (was !== "globe" && was !== "approaching" && was !== "leaving") return;
			map.stop();
			const my = ++generation.current;
			phase.current = "grabbed";
			window.clearTimeout(resumeTimer);
			resumeTimer = window.setTimeout(() => {
				if (my !== generation.current || phase.current !== "grabbed") return;
				if (was === "approaching") approach();
				else if (was === "leaving") leave();
				else startGlobe();
			}, 900);
		};
		canvas.addEventListener("pointerdown", grab, { capture: true, passive: true });
		canvas.addEventListener("wheel", grab, { capture: true, passive: true });
		const stopResume = () => window.clearTimeout(resumeTimer);

		// Anything touched on screen counts as someone being there.
		const activity = () => { lastActivity.current = Date.now(); };
		const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
		events.forEach(name => document.addEventListener(name, activity, { capture: true, passive: true }));

		// Parked and left alone for long enough: back up to the globe.
		const idleTimer = window.setInterval(() => {
			const o = latest.current;
			if (!o.enabled || (phase.current !== "local" && phase.current !== "manual")) return;
			if (idleLongEnough(parkedSince.current, lastActivity.current, Date.now())) leave();
		}, 5000);

		// The clouds drift over the ground whenever the globe is what you can see.
		let lastDrift = performance.now();
		const driftTimer = window.setInterval(() => {
			const now = performance.now();
			const seconds = (now - lastDrift) / 1000;
			lastDrift = now;
			if (document.visibilityState !== "visible" || map.getZoom() > 5.5) return;
			driftClouds(map, CLOUD_DRIFT_DEG_PER_S * seconds);
		}, 100);

		// Start: the turning globe, or (setting off) the flight straight to the car once there is a position.
		if (latest.current.enabled) startGlobe();

		return () => {
			generation.current++;
			controls.current = null;
			window.clearInterval(idleTimer);
			window.clearInterval(driftTimer);
			events.forEach(name => document.removeEventListener(name, activity, { capture: true }));
			canvas.removeEventListener("pointerdown", grab, { capture: true });
			canvas.removeEventListener("wheel", grab, { capture: true });
			stopResume();
			map.off("dragstart", manual);
			map.off("zoomstart", onUserZoom);
			map.off("rotatestart", onUserZoom);
			map.off("pitchstart", onUserZoom);
			transition(false);
		};
	}, [options.mapRef, options.mapLoaded]);

	// How long the car has been parked, for the idle wait.
	useEffect(() => { parkedSince.current = options.parked ? Date.now() : null; }, [options.parked]);

	// Come down to the car when the driver uses destinations or the car moves, and (setting off) straight away at start.
	useEffect(() => {
		if (!options.mapLoaded) return;
		if (options.wantsLocal) controls.current?.approachIfAway();
		else if (!options.enabled && options.hasPosition && phase.current === "waiting") controls.current?.approach();
	}, [options.wantsLocal, options.hasPosition, options.enabled, options.mapLoaded]);

	// Turning the setting off while on the globe: go to the car now.
	useEffect(() => { if (!options.enabled && options.mapLoaded) controls.current?.approachIfAway(); }, [options.enabled, options.mapLoaded]);

	// Lets the dev tools (and UI tests) see which part of the showcase is running; never exposed in packaged builds.
	if (process.env.NODE_ENV !== "production") (window as unknown as { __bravaShowcase?: () => string }).__bravaShowcase = () => phase.current;

	return { approachIfAway: () => controls.current?.approachIfAway() ?? false };
}
