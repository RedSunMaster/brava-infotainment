import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type mapboxgl from "mapbox-gl";
import { useMapOcclusion } from "./hooks/useMapOcclusion";
import { useMapbox } from "./hooks/useMapbox";
import { useRoute } from "./hooks/useRoute";
import { useNavigation } from "./hooks/useNavigation";
import { useSimulation } from "./hooks/useSimulation";
import { useCameraMode } from "./hooks/useCameraMode";
import NavigationCard from "./components/NavigationCard";
import MapControls from "./components/MapControls";
import {
	getRoute,
	snapToRoad,
	type NormalizedManeuver,
	type NormalizedRoute,
} from "./lib/routing";
import { DEV_ORIGIN, RoutingProvider, ZOOM_LEVEL } from "./constants";
import { Alert, Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import TripInfoCard from "./components/TripInfoCard";
import ConfirmNavDialog from "./components/ConfirmNavDialog";
import { usePositionPuck } from "./hooks/usePuckPosition";
import CarControls from "./components/CarControls";
import { useMapStyle } from "./hooks/useMapStyle";
import { useGps } from "./hooks/useGps";
import ClockWeatherChip, { statusChipSx } from "./components/ClockWeatherChip";
import { useThemeMode } from "./ThemeContext";
import DriveButton from "./components/DriveButton";
import { readFrequentPlaces, recordFrequentPlace } from "./lib/frequentPlaces";
import { readSavedPlaces, savePlace, type PlaceSlot } from "./lib/savedPlaces";
import { distanceKm } from "./lib/locationSearch";
import QuickDestinations from "./components/QuickDestinations";
import FlagRounded from "@mui/icons-material/FlagRounded";
import ReplayRounded from "@mui/icons-material/ReplayRounded";
import { useSpokenNavigation } from "./hooks/useSpokenNavigation";
import { kokoroVoice } from "./lib/kokoroVoice";
import {
	nextDrivingState,
	interactionLocked,
	type DrivingState,
} from "./lib/drivingState";

function closestRouteIndex(
	pos: [number, number],
	coords: [number, number][],
): number {
	let best = 0;
	let bestDist = Infinity;
	for (let i = 0; i < coords.length; i++) {
		const dx = pos[0] - coords[i][0];
		const dy = pos[1] - coords[i][1];
		const d = dx * dx + dy * dy;
		if (d < bestDist) {
			bestDist = d;
			best = i;
		}
	}
	return best;
}

interface ClickDestination {
	coords: [number, number];
	placeName: string;
}

type PendingNavAction = "destination" | "stop";

function mapFeatureName(feature: mapboxgl.MapboxGeoJSONFeature): string | null {
	const props = feature.properties ?? {};
	for (const key of [
		"name",
		"name_en",
		"name:en",
		"brand",
		"operator",
		"address",
	]) {
		const value = props[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

function pointFeatureCoords(
	feature: mapboxgl.MapboxGeoJSONFeature,
): [number, number] | null {
	const geometry = feature.geometry as GeoJSON.Geometry | undefined;
	if (geometry?.type !== "Point") return null;
	const [lng, lat] = geometry.coordinates;
	return [lng, lat];
}

function featureScore(feature: mapboxgl.MapboxGeoJSONFeature): number {
	const layerId = feature.layer?.id?.toLowerCase() ?? "";
	const props = feature.properties ?? {};
	let score = 0;
	if (pointFeatureCoords(feature)) score += 20;
	if (mapFeatureName(feature)) score += 20;
	if (
		/poi|place|transit|airport|parking|school|hospital|park|shop/.test(layerId)
	) {
		score += 15;
	}
	if (typeof props.maki === "string") score += 10;
	if (/road|street|building|landuse|water|contour|hillshade/.test(layerId)) {
		score -= 20;
	}
	return score;
}

function destinationFromFeatures(
	features: mapboxgl.MapboxGeoJSONFeature[],
	fallbackCoords: [number, number],
): ClickDestination | null {
	const best = features
		.filter((feature) => mapFeatureName(feature))
		.sort((a, b) => featureScore(b) - featureScore(a))[0];
	if (!best) return null;
	return {
		coords: pointFeatureCoords(best) ?? fallbackCoords,
		placeName: mapFeatureName(best) ?? "Selected location",
	};
}

async function reverseGeocodeDestination(
	coords: [number, number],
): Promise<ClickDestination> {
	const token = process.env.MAPBOX_TOKEN;
	if (!token) {
		return { coords, placeName: "Dropped pin" };
	}

	try {
		const [lng, lat] = coords;
		const url =
			`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
			`?types=poi,address,place,locality,neighborhood&limit=1&access_token=${token}`;
		const res = await fetch(url);
		const data = await res.json();
		const feature = data.features?.[0];
		return {
			coords: feature?.center ?? coords,
			placeName: feature?.place_name ?? "Dropped pin",
		};
	} catch {
		return { coords, placeName: "Dropped pin" };
	}
}

function summarizeManeuvers(maneuvers: NormalizedManeuver[]) {
	const totalSecs = maneuvers.reduce((a, m) => a + (m.time ?? 0), 0);
	const totalKm = maneuvers.reduce((a, m) => a + (m.length ?? 0), 0);
	const hrs = Math.floor(totalSecs / 3600);
	const mins = Math.round((totalSecs % 3600) / 60);
	return {
		duration: hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`,
		distance:
			totalKm >= 1
				? `${totalKm.toFixed(1)} km`
				: `${Math.round(totalKm * 1000)} m`,
	};
}

export default function App() {
	const { period, weather, weatherAppearance, updatePosition } = useThemeMode();
	const theme = useTheme();
	const kokoroStatus = useSyncExternalStore(kokoroVoice.subscribe, () => kokoroVoice.status);
	const voiceStatus =
		kokoroStatus === "ready"
			? "Kokoro (natural voice) ready"
			: kokoroStatus === "failed"
				? `system voice — Kokoro failed: ${kokoroVoice.error ?? "unknown error"}`
				: "system voice — Kokoro is loading (first use downloads about 90 MB)";
	const mapContainer = useRef<HTMLDivElement>(null);
	const simIndexRef = useRef(0);
	const lastPosRef = useRef<[number, number]>(DEV_ORIGIN);
	const lastBearingRef = useRef<number>(0);
	const lastSpeedRef = useRef<number>(0);
	const navDestRef = useRef<[number, number] | null>(null);
	const navStopsRef = useRef<[number, number][]>([]);
	const destinationClickInFlightRef = useRef(false);
	const [provider, setProvider] = useState<RoutingProvider>("mapbox");
	const [openPanel, setOpenPanel] = useState<"search" | "settings" | "media" | "climate" | null>(null);
	const [navActive, setNavActive] = useState(false);
	const [navToolsOpen, setNavToolsOpen] = useState(false);
	const previewMode =
		new URLSearchParams(window.location.search).get("preview") ===
		"car-portrait";
	const [drivingState, setDrivingState] = useState<DrivingState>("unknown");
	const [routeError, setRouteError] = useState<string | null>(null);
	const [savedPlaces, setSavedPlaces] = useState(readSavedPlaces);
	// Set while the search panel is choosing the Home or Work address.
	const [placeSlot, setPlaceSlot] = useState<PlaceSlot | null>(null);
	const [arrivedAt, setArrivedAt] = useState<string | null>(null);
	const navDestNameRef = useRef<string | null>(null);
	// True while the latest raw position is within 30 m of the end of the route.
	const [nearRouteEnd, setNearRouteEnd] = useState(false);
	const [routeBusy, setRouteBusy] = useState(false);
	const routeRequest = useRef(0);
	const [isRerouting, setIsRerouting] = useState(false);
	const [vehicleSpeedMs, setVehicleSpeedMs] = useState(0);
	const [pendingDest, setPendingDest] = useState<{
		coords: [number, number];
		placeName: string;
		duration: string;
		distance: string;
		action: PendingNavAction;
		route: NormalizedRoute;
		stops: [number, number][];
	} | null>(null);

	const { mapRef, mapLoaded } = useMapbox(mapContainer);
	const {
		coordsRef,
		maneuversRef,
		maneuvers,
		fetchRoute,
		applyRoute,
		drawRoute,
		clearRoute,
		trimRoute,
		trimRouteByDistance,
	} = useRoute(mapRef);

	// ── Camera ─────────────────────────────────────────────────────────────────
	const {
		cameraMode,
		orientation,
		followingRef,
		orientationRef,
		cameraTransitionRef,
		showOverview,
		resumeFollowing,
		toggleOrientation,
	} = useCameraMode(mapRef);

	const mapOffset = useMapOcclusion(mapRef, mapLoaded);

	// ── Puck — render loop drives both model and camera ────────────────────────
	// smoothLocate is destructured here alongside updatePuck and resetCursor.
	const { updatePuck, resetCursor, smoothLocate, syncPuck } = usePositionPuck(
		mapRef,
		mapLoaded,
		DEV_ORIGIN,
		coordsRef,
		followingRef,
		orientationRef,
		cameraTransitionRef,
		trimRouteByDistance,
		mapOffset,
	);

	useMapStyle(mapRef, mapLoaded, period, weather, weatherAppearance, () => {
		syncPuck(lastPosRef.current, lastBearingRef.current, lastSpeedRef.current);
	});

	// ── Reroute ────────────────────────────────────────────────────────────────
	const handleOffRoute = useCallback(async () => {
		if (!navDestRef.current || isRerouting) return;
		setIsRerouting(true);
		try {
			await fetchRoute(
				lastPosRef.current,
				navDestRef.current,
				provider,
				navStopsRef.current,
			);
			simIndexRef.current = 0;
			resetNavigation();
			resumeFollowing();
		} catch {
			setRouteError("Could not update the route. Keeping your current route.");
		} finally {
			setIsRerouting(false);
		}
	}, [fetchRoute, isRerouting, provider]);

	const {
		currentStep,
		setInstruction,
		onPositionUpdate,
		resetNavigation,
		distanceToNextM,
		timeToNextS,
	} = useNavigation(
		mapRef,
		maneuversRef,
		coordsRef,
		simIndexRef,
		handleOffRoute,
	);

	// ── Position update ────────────────────────────────────────────────────────
	const trackedPositionUpdate = useCallback(
		async (
			pos: [number, number],
			bearing: number,
			speed: number,
			prov: RoutingProvider,
		) => {
			lastPosRef.current = pos;
			updatePosition(pos);
			lastBearingRef.current = bearing;
			lastSpeedRef.current = speed;
			setVehicleSpeedMs(speed);
			setDrivingState((previous) => nextDrivingState(previous, speed));
			const routeEnd = coordsRef.current[coordsRef.current.length - 1];
			setNearRouteEnd(!!routeEnd && distanceKm(pos, routeEnd) < 0.03);
			updatePuck(pos, bearing, speed);
			await onPositionUpdate(pos, bearing, speed, prov);
		},
		[updatePuck, onPositionUpdate, updatePosition],
	);

	// ── GPS ────────────────────────────────────────────────────────────────────
	const { status: gpsStatus } = useGps(
		useCallback(
			(pos: [number, number], bearing: number, speed: number) => {
				lastPosRef.current = pos;
				updatePosition(pos);
				lastBearingRef.current = bearing;
				lastSpeedRef.current = speed;
				setVehicleSpeedMs(speed);
				setDrivingState((previous) => nextDrivingState(previous, speed));

				updatePuck(pos, bearing, speed);

				if (navActive && !isRerouting) {
					if (coordsRef.current.length > 0) {
						const idx = closestRouteIndex(pos, coordsRef.current);
						simIndexRef.current = idx;
						trimRoute(idx);
					}
					trackedPositionUpdate(pos, bearing, speed, provider);
				}
			},
			[
				navActive,
				isRerouting,
				updatePuck,
				trackedPositionUpdate,
				provider,
				trimRoute,
			],
		),
	);

	// ── Simulation ─────────────────────────────────────────────────────────────
	const isDriving = interactionLocked(
		previewMode,
		gpsStatus === "fix",
		drivingState,
	);
	useEffect(() => {
		if (isDriving && !navActive) {
			routeRequest.current++;
			setRouteBusy(false);
			setPendingDest(null);
		}
	}, [isDriving, navActive]);
	const guidance = useSpokenNavigation(
		maneuvers[currentStep + 1]?.instruction ?? "",
		distanceToNextM,
		navActive,
	);
	const { startSimulation, stopSimulation } = useSimulation(
		coordsRef,
		simIndexRef,
		trackedPositionUpdate,
		setInstruction,
	);

	async function handleToggleProvider() {
		setProvider((p) => (p === "mapbox" ? "valhalla" : "mapbox"));
	}

	const [mapBearing, setMapBearing] = useState(0);
	useEffect(() => {
		const map = mapRef.current;
		if (!map) return;
		let rafId: number;
		const onMove = () => {
			cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => setMapBearing(map.getBearing()));
		};
		map.on("move", onMove);
		return () => {
			map.off("move", onMove);
			cancelAnimationFrame(rafId);
		};
	}, [mapLoaded]);

	const handleSearchSelect = useCallback(
		async (coords: [number, number], placeName: string) => {
			// A new destination needs the car parked; a stop can be added on the move.
			if (isDriving && !navActive)
				throw new Error("Choose a destination when parked.");
			const request = ++routeRequest.current;
			setRouteBusy(true);
			setRouteError(null);
			try {
				const stops = navActive ? [...navStopsRef.current, coords] : [];
				const destination =
					navActive && navDestRef.current ? navDestRef.current : coords;
				const route = await getRoute(
					lastPosRef.current,
					destination,
					provider,
					stops,
				);
				if (request !== routeRequest.current) return;
				if (!route.maneuvers.length)
					throw new Error("No drivable route was found.");
				if (!navActive) drawRoute(route.coords);
				const summary = summarizeManeuvers(route.maneuvers);
				setPendingDest({
					coords,
					placeName,
					...summary,
					action: navActive ? "stop" : "destination",
					route,
					stops,
				});
			} finally {
				if (request === routeRequest.current) setRouteBusy(false);
			}
		},
		[isDriving, navActive, provider, drawRoute, showOverview],
	);

	useEffect(() => {
		const map = mapRef.current;
		if (!mapLoaded || !map) return;

		// Shared by a tap (parked) and a press-and-hold (also while navigating).
		const pickLocation = async (lngLat: mapboxgl.LngLat, point: mapboxgl.Point) => {
			if (destinationClickInFlightRef.current) return;
			destinationClickInFlightRef.current = true;
			try {
				const coords: [number, number] = [lngLat.lng, lngLat.lat];
				const features = map.queryRenderedFeatures([
					[point.x - 18, point.y - 18],
					[point.x + 18, point.y + 18],
				]);
				const destination =
					destinationFromFeatures(features, coords) ??
					(await reverseGeocodeDestination(coords));
				await handleSearchSelect(destination.coords, destination.placeName);
			} catch (cause) {
				setRouteError(
					cause instanceof Error ? cause.message : "Could not calculate route.",
				);
			} finally {
				destinationClickInFlightRef.current = false;
			}
		};

		// A tap sets a destination only while parked, so a stray touch on the
		// move does nothing.
		let ignoreClickUntil = 0;
		const handleMapClick = (event: mapboxgl.MapMouseEvent) => {
			if (isDriving || Date.now() < ignoreClickUntil) return;
			void pickLocation(event.lngLat, event.point);
		};

		// Press and hold picks the location under the finger. During navigation
		// it adds a stop, and works while moving because it is deliberate.
		let holdTimer = 0;
		let holdStart: mapboxgl.Point | null = null;
		const cancelHold = () => {
			window.clearTimeout(holdTimer);
			holdTimer = 0;
		};
		const startHold = (event: mapboxgl.MapMouseEvent | mapboxgl.MapTouchEvent) => {
			cancelHold();
			if ("points" in event && event.points.length > 1) return;
			if (isDriving && !navActive) return;
			const { lngLat, point } = event;
			holdStart = point;
			holdTimer = window.setTimeout(() => {
				holdTimer = 0;
				ignoreClickUntil = Date.now() + 800;
				void pickLocation(lngLat, point);
			}, 650);
		};
		const moveHold = (event: mapboxgl.MapMouseEvent | mapboxgl.MapTouchEvent) => {
			if (holdTimer && holdStart && event.point.dist(holdStart) > 12) cancelHold();
		};

		map.on("click", handleMapClick);
		map.on("mousedown", startHold);
		map.on("touchstart", startHold);
		map.on("mousemove", moveHold);
		map.on("touchmove", moveHold);
		for (const end of ["mouseup", "touchend", "touchcancel", "dragstart"] as const)
			map.on(end, cancelHold);
		return () => {
			cancelHold();
			map.off("click", handleMapClick);
			map.off("mousedown", startHold);
			map.off("touchstart", startHold);
			map.off("mousemove", moveHold);
			map.off("touchmove", moveHold);
			for (const end of ["mouseup", "touchend", "touchcancel", "dragstart"] as const)
				map.off(end, cancelHold);
		};
	}, [handleSearchSelect, mapLoaded, mapRef, isDriving, navActive]);

	// Fit the route preview once the confirmation card is on screen, so the
	// route fills the space actually left between the cards and the dock.
	const previewCoords = pendingDest && !navActive ? pendingDest.route.coords : null;
	useEffect(() => {
		if (!previewCoords) return;
		const frame = requestAnimationFrame(() => showOverview(previewCoords));
		return () => cancelAnimationFrame(frame);
	}, [previewCoords]);

	// ── Saved and frequent destinations ────────────────────────────────────────
	useEffect(() => {
		if (openPanel !== "search") setPlaceSlot(null);
	}, [openPanel]);
	const quickPlaces = useMemo(() => {
		const saved = Object.values(savedPlaces);
		const near = (a: [number, number], b: [number, number]) =>
			Math.abs(a[0] - b[0]) < 0.0005 && Math.abs(a[1] - b[1]) < 0.0005;
		return readFrequentPlaces()
			.filter((place) => !saved.some((item) => near(item.coords, place.coords)))
			.slice(0, 2);
		// Re-read when a trip starts or ends, since that changes the ranking.
	}, [savedPlaces, navActive]);
	function handleQuickDestination(coords: [number, number], placeName: string) {
		setOpenPanel(null);
		handleSearchSelect(coords, placeName).catch((cause) =>
			setRouteError(
				cause instanceof Error ? cause.message : "Could not calculate route.",
			),
		);
	}
	function handleSetPlace(slot: PlaceSlot) {
		setPlaceSlot(slot);
		setOpenPanel("search");
	}

	async function handleConfirmNav() {
		if (!pendingDest || (isDriving && pendingDest.action !== "stop")) return;
		recordFrequentPlace(pendingDest.placeName, pendingDest.coords);
		stopSimulation();
		applyRoute(pendingDest.route);
		if (pendingDest.action === "destination") {
			navDestRef.current = pendingDest.coords;
			navDestNameRef.current = pendingDest.placeName;
		}
		setArrivedAt(null);
		setNearRouteEnd(false);
		navStopsRef.current = pendingDest.stops;
		setPendingDest(null);
		setNavActive(true);
		setNavToolsOpen(false);
		setOpenPanel(null);
		resetNavigation();
		resetCursor();
		simIndexRef.current = 0;
		resumeFollowing();
		if (previewMode && gpsStatus !== "fix") startSimulation(provider);
	}

	function handleCancelSearch() {
		routeRequest.current++;
		setPendingDest(null);
		setRouteBusy(false);
		if (navActive) {
			drawRoute(coordsRef.current);
			resumeFollowing();
		} else {
			clearRoute();
			handleLocate();
		}
	}

	const handleEndNavigation = useCallback(() => {
		stopSimulation();
		resetNavigation();
		resetCursor();
		if (previewMode && gpsStatus !== "fix") {
			setVehicleSpeedMs(0);
			setDrivingState("parked");
			lastSpeedRef.current = 0;
		}
		setNavActive(false);
		setNavToolsOpen(false);
		setIsRerouting(false);
		setPendingDest(null);
		simIndexRef.current = 0;
		navDestRef.current = null;
		navDestNameRef.current = null;
		setNearRouteEnd(false);
		navStopsRef.current = [];
		clearRoute();
		resumeFollowing();
		smoothLocate();
	}, [
		clearRoute,
		smoothLocate,
		resetNavigation,
		resetCursor,
		resumeFollowing,
		stopSimulation,
		previewMode,
		gpsStatus,
	]);

	// ── Arrival ────────────────────────────────────────────────────────────────
	// The last maneuver is the arrival itself: finish when it becomes current,
	// or when the car is within a few metres of it (real GPS rarely lands on the
	// exact final point).
	useEffect(() => {
		if (!navActive || maneuvers.length < 2) return;
		const last = maneuvers.length - 1;
		// "Near the end" uses the raw position as well as the smoothed, map-matched
		// distance, because smoothing can leave the latter a few car lengths short
		// once position updates stop.
		const arrived =
			currentStep >= last ||
			(currentStep === last - 1 &&
				(nearRouteEnd || (distanceToNextM != null && distanceToNextM <= 25)));
		if (!arrived) return;
		const name = navDestNameRef.current;
		handleEndNavigation();
		setArrivedAt(name ?? "your destination");
	}, [currentStep, distanceToNextM, nearRouteEnd, maneuvers.length, navActive, handleEndNavigation]);
	useEffect(() => {
		if (!arrivedAt) return;
		const timer = window.setTimeout(() => setArrivedAt(null), 20000);
		return () => window.clearTimeout(timer);
	}, [arrivedAt]);

	function handleLocate() {
		resumeFollowing();
		smoothLocate();
	}

	useEffect(() => {
		if (!mapLoaded || !previewMode) return;
		async function snapInitialPosition() {
			const snapped = await snapToRoad([DEV_ORIGIN, DEV_ORIGIN], provider);
			lastPosRef.current = snapped;
			lastBearingRef.current = 0;
			lastSpeedRef.current = 0;
			syncPuck(snapped, 0, 0);
			mapRef.current?.easeTo({
				center: snapped,
				zoom: ZOOM_LEVEL,
				pitch: 45,
				bearing: 0,
				offset: [0, (mapRef.current?.getContainer().clientHeight ?? 0) * 0.2],
				duration: 800,
				essential: true,
			});
		}
		snapInitialPosition().catch(() =>
			setRouteError("Preview position could not be matched to the road."),
		);
	}, [mapLoaded]);

	return (
		<Box
			sx={{
				height: "100vh",
				width: "100vw",
				position: "fixed",
				inset: 0,
				display: "flex",
				flexDirection: "column",
				bgcolor: "background.default",
				overflow: "hidden",
			}}
		>
				<Box
					data-top-overlay
					sx={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						p: "16px 24px",
						pointerEvents: "none",
						"& > *": { pointerEvents: "auto" },
						zIndex: 10,
						display: "grid",
						gap: 2,
					}}
				>
					<Box
						sx={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							gap: 2,
						}}
					>
						<ClockWeatherChip
							position={lastPosRef.current}
							gpsStatus={gpsStatus}
						/>
						<Typography
							role="status"
							sx={{ ...statusChipSx(theme), fontSize: 24, fontWeight: 700 }}
						>
							{gpsStatus !== "fix" && !(previewMode && navActive) ? (
								previewMode ? "Preview" : "Waiting for GPS"
							) : (
								<>
									<Box component="span" aria-label="Current speed" sx={{ fontSize: 34, fontWeight: 800, fontVariantNumeric: "tabular-nums", minWidth: "2ch", textAlign: "right" }}>
										{Math.round(vehicleSpeedMs * 3.6)}
									</Box>
									<Box component="span" sx={{ fontSize: 20, color: "text.secondary" }}>
										km/h{gpsStatus !== "fix" ? " · simulated" : ""}
									</Box>
								</>
							)}
						</Typography>
					</Box>
					{navActive && (
						<NavigationCard
							maneuvers={maneuvers}
							currentStep={currentStep}
							distanceToNextM={distanceToNextM}
							timeToNextS={timeToNextS}
							isDriving={isDriving}
						/>
					)}
					<Box component="nav" id="navigation-options" aria-label="Map controls" sx={{ display: navActive && !navToolsOpen ? "none" : "flex", alignItems: "center", gap: 1, position: "relative", zIndex: 20, order: navActive ? 1 : 0, "& .map-action": { minWidth: "var(--map-target)", minHeight: "var(--car-target, 112px)", bgcolor: "background.paper", boxShadow: 2, borderRadius: 3, "&:hover": { bgcolor: "surface.main" } }, "--map-target": "clamp(76px, 8vw, 88px)", }}>
				<MapControls
                    panel={openPanel === "search" || openPanel === "settings" ? openPanel : null}
                    setPanel={setOpenPanel}
					cameraMode={cameraMode}
					orientation={orientation}
					hasRoute={maneuvers.length > 0}
					currentBearing={mapBearing}
					currentPosition={lastPosRef.current}
					mapboxToken={process.env.MAPBOX_TOKEN}
					onOverview={() => showOverview(coordsRef.current)}
					onToggleOrientation={() =>
						toggleOrientation(lastBearingRef.current, lastPosRef.current)
					}
					onSearchSelect={
						placeSlot
							? async (coords, placeName) => {
									setSavedPlaces(savePlace(placeSlot, placeName, coords));
								}
							: handleSearchSelect
					}
					searchTitle={placeSlot ? (placeSlot === "home" ? "Set Home address" : "Set Work address") : undefined}
					onSetPlace={navActive ? undefined : handleSetPlace}
					voiceStatus={voiceStatus}
					onCancelRouting={() => {
						routeRequest.current++;
						setRouteBusy(false);
					}}
					onLocate={handleLocate}
					isNavActive={navActive}
					provider={provider}
					onToggleProvider={handleToggleProvider}
					isDriving={isDriving}
					extraActions={navActive && (
						<DriveButton color="inherit"
							className="map-action"
							aria-label="Repeat navigation instruction"
							disabled={!guidance.supported}
							onClick={guidance.speak}
						>
							<ReplayRounded />
						</DriveButton>
					)}
				/>
					</Box>

					{!navActive && !pendingDest && !arrivedAt && !isDriving && (
						<QuickDestinations
							saved={savedPlaces}
							frequent={quickPlaces}
							onGo={handleQuickDestination}
							onSet={handleSetPlace}
							disabled={routeBusy}
						/>
					)}
					{(routeBusy || isRerouting) && (
						<Alert severity="info" sx={{ fontSize: 28, order: 2 }}>
							Calculating route...
						</Alert>
					)}
					{routeError && (
						<Alert
							severity="error"
							onClose={() => setRouteError(null)}
							sx={{ fontSize: 26, order: 2 }}
						>
							{routeError}
						</Alert>
					)}
				<Box
					sx={{
						position: "relative",
						zIndex: 12,
						order: navActive ? 0 : 1,
					}}
				>
					{pendingDest ? (
						<ConfirmNavDialog
							placeName={pendingDest.placeName}
							duration={pendingDest.duration}
							distance={pendingDest.distance}
							confirmLabel={
								pendingDest.action === "stop" ? "Add stop" : "Start"
							}
							onConfirm={handleConfirmNav}
							onCancel={handleCancelSearch}
							disabled={isDriving && pendingDest.action !== "stop"}
						/>
					) : navActive ? (
						<TripInfoCard
							maneuvers={maneuvers}
							currentStep={currentStep}
							distanceToNextM={distanceToNextM}
							timeToNextS={timeToNextS}
							toolsOpen={navToolsOpen}
                            onToggleTools={() => setNavToolsOpen(value => !value)}
                            onLocate={handleLocate}
                            onEndNav={handleEndNavigation}
							isDriving={isDriving}
							muted={guidance.muted}
							onToggleMute={guidance.toggleMute}
							voiceSupported={guidance.supported}
							orientation={orientation}
							canLocate={cameraMode !== "following"}
							onToggleOrientation={() =>
								toggleOrientation(lastBearingRef.current, lastPosRef.current)
							}
						/>
					) : arrivedAt ? (
						<Box role="status" sx={{ bgcolor: "background.paper", borderRadius: 3, border: "1px solid", borderColor: "divider", p: 2, display: "flex", alignItems: "center", gap: 2 }}>
							<FlagRounded color="primary" sx={{ fontSize: 56, flexShrink: 0 }} />
							<Box sx={{ flex: 1, minWidth: 0 }}>
								<Typography sx={{ fontSize: 34, fontWeight: 800 }}>You have arrived</Typography>
								<Typography noWrap sx={{ fontSize: 26, color: "text.secondary" }}>{arrivedAt.split(",")[0]}</Typography>
							</Box>
							<DriveButton variant="contained" onClick={() => setArrivedAt(null)}>Done</DriveButton>
						</Box>
					) : null}
				</Box>
				</Box>
			<Box
				sx={{ position: "absolute", inset: 0 }}
			>
				<Box
					ref={mapContainer}
					sx={{
						position: "absolute",
						inset: 0,
						overflow: "hidden",
					}}
				/>

			</Box>
			<CarControls isDriving={isDriving} panel={openPanel === "media" || openPanel === "climate" ? openPanel : null} setPanel={setOpenPanel} />
		</Box>
	);
}
