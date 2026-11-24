import { useCallback, useEffect, useRef, useState } from "react";
import { ipcRenderer } from "electron";
import mapboxgl from "mapbox-gl";
import type { LngLat } from "../lib/exploration";
import { TripRecorder, readTrips, trimTrips, tripSeconds, BAND_LABEL, scoreBand, type DriveEvent, type DriveSave, type LiveDrive, type Trip } from "../lib/drives";
import { computeStreaks, currentChallenges, doneIds } from "../lib/driveChallenges";
import { RaceGhost, RaceMatcher, clock } from "../lib/raceGhost";
import type { DrivesLoad } from "../drivesMain";
import type { DiscoveryNotice } from "./useExploration";

const NOTICE_MS = 7_000;
const FLASH_MS = 3_500;
/** The dashboard's numbers are refreshed this often, not on every fix. */
const PUBLISH_MS = 900;
const GHOST_STEP_MS = 200;
const RETRY_MS = 15_000;

export interface RaceStatus {
	/** Seconds behind (+) or ahead (−) of the ghost. */
	deltaS: number;
	/** How far along the ghost's road the car is, 0 to 1. */
	progress: number;
	/** The ghost's total time, and the date of its run. */
	ghostSeconds: number;
	ghostDate: number;
}

export interface DriveFlash { kind: DriveEvent; key: number }

const EVENT_TEXT: Record<DriveEvent, string> = { brake: "Hard braking", accel: "Hard acceleration", corner: "Sharp cornering" };
export const flashText = (flash: DriveFlash) => EVENT_TEXT[flash.kind];

/**
 * Records every drive as trips (real GPS fixes and simulated drives), keeps them in a file per profile, scores how smoothly each
 * was driven, finds the earlier run of the same route to race as a ghost, and announces trip results, finished challenges and streaks.
 */
export function useDrives(
	mapRef: React.RefObject<mapboxgl.Map | null>,
	mapLoaded: boolean,
	profileId: string,
	showGhost: boolean,
	/** The posted limit under the car in metres per second, where it is known. */
	limitSource: React.RefObject<() => number | null>,
	/** The destination navigation is heading for, if any. */
	destinationSource: React.RefObject<() => LngLat | null>,
) {
	const [trips, setTrips] = useState<Trip[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [live, setLive] = useState<LiveDrive | null>(null);
	const [race, setRace] = useState<RaceStatus | null>(null);
	const [flash, setFlash] = useState<DriveFlash | null>(null);
	const [notices, setNotices] = useState<DiscoveryNotice[]>([]);

	const tripsRef = useRef<Trip[]>([]);
	const loadedRef = useRef(false);
	/** Trips finished before the saved ones were read; added once they are. */
	const pending = useRef<Trip[]>([]);
	const dirty = useRef(false);
	const recorder = useRef(new TripRecorder());
	const ghostRef = useRef<RaceGhost | null>(null);
	const matcherRef = useRef<RaceMatcher | null>(null);
	/** The trip the matcher and ghost belong to (its start time), so a new trip starts a new search. */
	const raceFor = useRef<number | null>(null);
	const lastPublish = useRef(0);
	const raceStatus = useRef<RaceStatus | null>(null);
	const showGhostRef = useRef(showGhost);
	showGhostRef.current = showGhost;

	const notify = useCallback((item: Omit<DiscoveryNotice, "key">) => {
		const notice: DiscoveryNotice = { ...item, key: `${item.kind}:${item.name}:${Date.now()}:${Math.random()}` };
		setNotices(list => [...list, notice].slice(-3));
		window.setTimeout(() => setNotices(list => list.filter(entry => entry.key !== notice.key)), NOTICE_MS);
	}, []);
	const dismissNotice = useCallback((key: string) => setNotices(list => list.filter(item => item.key !== key)), []);

	const save = useCallback(() => {
		if (!loadedRef.current || !dirty.current) return;
		dirty.current = false;
		const data: DriveSave = { version: 1, trips: tripsRef.current };
		void ipcRenderer.invoke("drives:save", profileId, JSON.stringify(data)).catch(() => { dirty.current = true; });
	}, [profileId]);

	const publish = useCallback(() => {
		lastPublish.current = Date.now();
		setLive(recorder.current.live);
		const status = raceStatus.current;
		setRace(status ? { ...status } : null);
	}, []);

	/** A trip has ended: file it, and say how it went. */
	const addTrip = useCallback((finished: Trip) => {
		const now = Date.now();
		const ghost = ghostRef.current;
		const trip: Trip = ghost && ghost.finished(finished.to) ? { ...finished, race: { ghostId: ghost.trip.id, deltaS: tripSeconds(finished) - tripSeconds(ghost.trip) } } : finished;
		ghostRef.current = null; matcherRef.current = null; raceFor.current = null; raceStatus.current = null;
		if (!loadedRef.current) { pending.current.push(trip); publish(); return; }
		const before = tripsRef.current;
		const doneBefore = doneIds(currentChallenges(now, before));
		const streakBefore = computeStreaks(before, now);
		const after = trimTrips([...before, trip]);
		tripsRef.current = after;
		dirty.current = true;
		setTrips(after);
		save();

		const km = (trip.distanceM / 1000).toFixed(1);
		if (trip.score !== null) notify({ kind: "drive", name: `${trip.score} · ${BAND_LABEL[scoreBand(trip.score)]}`, detail: `Smooth driving · ${km} km trip` });
		if (trip.race) notify({ kind: "drive", name: trip.race.deltaS < 0 ? `${clock(trip.race.deltaS)} faster` : trip.race.deltaS > 0 ? `${clock(trip.race.deltaS)} slower` : "Dead level", detail: trip.race.deltaS < 0 ? "You beat your ghost" : "The ghost won this one" });
		const doneAfter = currentChallenges(now, after);
		for (const challenge of [...doneAfter.daily, ...doneAfter.weekly]) if (challenge.done && !doneBefore.has(challenge.id)) notify({ kind: "drive", name: challenge.title, detail: challenge.period === "day" ? "Daily challenge complete" : "Weekly challenge complete" });
		const streakAfter = computeStreaks(after, now);
		if (streakAfter.days > streakBefore.days && streakAfter.days > 1) notify({ kind: "drive", name: `${streakAfter.days} days in a row`, detail: "Driving streak" });
		if (streakAfter.smooth > streakBefore.smooth && streakAfter.smooth >= 3) notify({ kind: "drive", name: `${streakAfter.smooth} smooth trips in a row`, detail: "Smooth streak" });
		publish();
	}, [notify, publish, save]);

	/** Every real or simulated fix. */
	const recordFix = useCallback((pos: LngLat, speed: number, bearing: number | null) => {
		const now = Date.now();
		const limit = limitSource.current?.() ?? null;
		const result = recorder.current.fix(now, pos, speed, bearing, limit);
		if (result.finished) addTrip(result.finished);
		if (result.event) {
			setFlash({ kind: result.event, key: now });
			window.setTimeout(() => setFlash(current => current && current.key === now ? null : current), FLASH_MS);
		}
		const drive = recorder.current.live;
		if (drive) {
			// A new trip looks for its ghost from where it started.
			if (raceFor.current !== drive.startedAt) {
				raceFor.current = drive.startedAt;
				ghostRef.current = null;
				raceStatus.current = null;
				const origin = recorder.current.origin;
				matcherRef.current = origin && loadedRef.current ? new RaceMatcher(tripsRef.current, origin) : null;
			}
			const elapsed = (now - drive.startedAt) / 1000;
			if (!ghostRef.current && matcherRef.current) {
				const found = matcherRef.current.update(pos, drive.distanceM, destinationSource.current?.() ?? null);
				if (found) { ghostRef.current = found; matcherRef.current = null; }
				else if (!matcherRef.current.any) matcherRef.current = null;
			}
			const ghost = ghostRef.current;
			if (ghost) {
				const compared = ghost.compare(pos, elapsed);
				if (compared) raceStatus.current = { deltaS: compared.deltaS, progress: ghost.length > 0 ? Math.min(1, compared.along / ghost.length) : 0, ghostSeconds: tripSeconds(ghost.trip), ghostDate: ghost.trip.start };
				else { ghostRef.current = null; raceStatus.current = null; }
			}
		}
		if (result.event || result.finished || now - lastPublish.current >= PUBLISH_MS) publish();
	}, [addTrip, destinationSource, limitSource, publish]);

	// This profile's trips. If the file exists but cannot be read, nothing is saved over it and loading is tried again.
	useEffect(() => {
		let cancelled = false;
		let retry: number | undefined;
		const recorderForProfile = new TripRecorder();
		recorder.current = recorderForProfile;
		const load = () => {
			void (ipcRenderer.invoke("drives:load", profileId) as Promise<DrivesLoad>).catch((cause: unknown): DrivesLoad => ({ status: "error", message: String(cause) })).then(result => {
				if (cancelled) return;
				if (result.status === "error") {
					console.error("Trip history could not be read; not saving over it, trying again.", result);
					retry = window.setTimeout(load, RETRY_MS);
					return;
				}
				const saved = result.status === "ok" ? readTrips(result.data) : [];
				const early = pending.current.splice(0);
				tripsRef.current = early.length ? trimTrips([...saved, ...early]) : saved;
				loadedRef.current = true;
				dirty.current = early.length > 0;
				setTrips(tripsRef.current);
				setLoaded(true);
				save();
			});
		};
		load();
		const closeTrip = () => { const finished = recorderForProfile.finish(); if (finished) addTrip(finished); save(); };
		window.addEventListener("beforeunload", closeTrip);
		return () => {
			cancelled = true;
			window.clearTimeout(retry);
			window.removeEventListener("beforeunload", closeTrip);
			closeTrip();
			loadedRef.current = false;
			tripsRef.current = [];
			ghostRef.current = null; matcherRef.current = null; raceFor.current = null; raceStatus.current = null;
		};
	}, [profileId]);

	// The ghost on the map: a translucent dot that drives the old run at the time it took.
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !mapLoaded) return;
		const element = document.createElement("div");
		element.setAttribute("aria-label", "Ghost");
		element.style.cssText = "width:30px;height:30px;border-radius:50%;background:rgba(140,190,255,0.55);border:3px solid rgba(255,255,255,0.85);box-shadow:0 0 14px 4px rgba(120,170,255,0.7);pointer-events:none;display:none";
		const marker = new mapboxgl.Marker({ element, pitchAlignment: "map", rotationAlignment: "map" }).setLngLat([0, 0]).addTo(map);
		const timer = window.setInterval(() => {
			const ghost = ghostRef.current;
			const drive = recorder.current.live;
			if (!ghost || !drive || !showGhostRef.current) { element.style.display = "none"; return; }
			marker.setLngLat(ghost.positionAt((Date.now() - drive.startedAt) / 1000));
			element.style.display = "block";
		}, GHOST_STEP_MS);
		return () => { window.clearInterval(timer); marker.remove(); };
	}, [mapRef, mapLoaded]);

	/** Clears this profile's trip history (and with it, challenges progress, streaks and ghosts). */
	const reset = useCallback(() => {
		if (!loadedRef.current) return;
		tripsRef.current = [];
		dirty.current = true;
		setTrips([]);
		save();
	}, [save]);

	return { recordFix, trips, loaded, live, race, flash, notices, dismissNotice, reset };
}
