import React, { useCallback, useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
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
import TripInfoCard from "./components/TripInfoCard";
import ConfirmNavDialog from "./components/ConfirmNavDialog";
import { usePositionPuck } from "./hooks/usePuckPosition";
import CarControls from "./components/CarControls";
import { useMapStyle } from "./hooks/useMapStyle";
import { useGps } from "./hooks/useGps";
import ClockWeatherChip from "./components/ClockWeatherChip";
import { useThemeMode } from "./ThemeContext";
import DriveButton from "./components/DriveButton";
import {
	VolumeOffRounded,
	VolumeUpRounded,
	ReplayRounded,
} from "@mui/icons-material";
import { useSpokenNavigation } from "./hooks/useSpokenNavigation";
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
	const { mode, period, updatePosition } = useThemeMode();
	const mapContainer = useRef<HTMLDivElement>(null);
	const simIndexRef = useRef(0);
	const lastPosRef = useRef<[number, number]>(DEV_ORIGIN);
	const lastBearingRef = useRef<number>(0);
	const lastSpeedRef = useRef<number>(0);
	const navDestRef = useRef<[number, number] | null>(null);
	const navStopsRef = useRef<[number, number][]>([]);
	const destinationClickInFlightRef = useRef(false);
	const [provider, setProvider] = useState<RoutingProvider>("mapbox");
	const [navActive, setNavActive] = useState(false);
	const previewMode =
		new URLSearchParams(window.location.search).get("preview") ===
		"car-portrait";
	const [drivingState, setDrivingState] = useState<DrivingState>("unknown");
	const [routeError, setRouteError] = useState<string | null>(null);
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
	);

	useMapStyle(mapRef, mapLoaded, mode, period, () => {
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
		if (isDriving) {
			routeRequest.current++;
			setRouteBusy(false);
			setPendingDest(null);
		}
	}, [isDriving]);
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
			if (isDriving) throw new Error("Choose a destination when parked.");
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
				if (!navActive) {
					drawRoute(route.coords);
					showOverview(route.coords);
				}
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

		const handleMapClick = async (event: mapboxgl.MapMouseEvent) => {
			if (isDriving || destinationClickInFlightRef.current) return;
			destinationClickInFlightRef.current = true;
			try {
				const coords: [number, number] = [event.lngLat.lng, event.lngLat.lat];
				const point = event.point;
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

		map.on("click", handleMapClick);
		return () => {
			map.off("click", handleMapClick);
		};
	}, [handleSearchSelect, mapLoaded, mapRef, isDriving]);

	async function handleConfirmNav() {
		if (!pendingDest || isDriving) return;
		stopSimulation();
		applyRoute(pendingDest.route);
		if (pendingDest.action === "destination")
			navDestRef.current = pendingDest.coords;
		navStopsRef.current = pendingDest.stops;
		setPendingDest(null);
		setNavActive(true);
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
		setIsRerouting(false);
		setPendingDest(null);
		simIndexRef.current = 0;
		navDestRef.current = null;
		navStopsRef.current = [];
		clearRoute();
		resumeFollowing();
		mapRef.current?.easeTo({
			center: lastPosRef.current,
			zoom: ZOOM_LEVEL,
			pitch: 0,
			bearing: 0,
			duration: 800,
		});
	}, [
		clearRoute,
		mapRef,
		resetNavigation,
		resetCursor,
		resumeFollowing,
		stopSimulation,
		previewMode,
		gpsStatus,
	]);

	useEffect(() => {
		if (navActive && maneuvers.length > 0 && currentStep >= maneuvers.length) {
			handleEndNavigation();
		}
	}, [currentStep, maneuvers.length, navActive, handleEndNavigation]);

	function handleLocate() {
		resumeFollowing();
		smoothLocate(lastPosRef.current, lastBearingRef.current);
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
				pitch: 0,
				bearing: 0,
				duration: 800,
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
				sx={{ flex: 1, minHeight: 0, position: "relative", m: "12px 12px 0" }}
			>
				<Box
					ref={mapContainer}
					sx={{
						position: "absolute",
						inset: 0,
						borderRadius: 3,
						overflow: "hidden",
					}}
				/>
				<Box
					sx={{
						position: "absolute",
						top: 16,
						left: 16,
						right: 16,
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
							sx={{
								bgcolor: "background.paper",
								borderRadius: 2,
								p: 1.5,
								fontSize: 24,
								fontWeight: 700,
							}}
						>
							{previewMode && gpsStatus !== "fix"
								? navActive
									? "Preview: simulated drive"
									: "Preview"
								: gpsStatus !== "fix"
									? "Waiting for GPS"
									: vehicleSpeedMs > 1
										? "Driving"
										: "Parked"}
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
					{(routeBusy || isRerouting) && (
						<Alert severity="info" sx={{ fontSize: 28 }}>
							Calculating route...
						</Alert>
					)}
					{routeError && (
						<Alert
							severity="error"
							onClose={() => setRouteError(null)}
							sx={{ fontSize: 26 }}
						>
							{routeError}
						</Alert>
					)}
				</Box>
				<Box
					sx={{
						position: "absolute",
						bottom: 16,
						left: 16,
						right: 16,
						zIndex: 12,
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
							disabled={isDriving}
						/>
					) : navActive ? (
						<TripInfoCard
							maneuvers={maneuvers}
							currentStep={currentStep}
							distanceToNextM={distanceToNextM}
							timeToNextS={timeToNextS}
							onEndNav={handleEndNavigation}
							isDriving={isDriving}
						/>
					) : null}
				</Box>
			</Box>
			<CarControls isDriving={isDriving}>
				<MapControls
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
					onSearchSelect={handleSearchSelect}
					onCancelRouting={() => {
						routeRequest.current++;
						setRouteBusy(false);
					}}
					onLocate={handleLocate}
					isNavActive={navActive}
					provider={provider}
					onToggleProvider={handleToggleProvider}
					isDriving={isDriving}
				/>
				{navActive && (
					<DriveButton
						aria-label="Repeat navigation instruction"
						disabled={!guidance.supported}
						onClick={guidance.speak}
					>
						<ReplayRounded />
					</DriveButton>
				)}
				{navActive && (
					<DriveButton
						aria-label={
							guidance.muted ? "Unmute navigation" : "Mute navigation"
						}
						aria-pressed={guidance.muted}
						disabled={!guidance.supported}
						onClick={guidance.toggleMute}
					>
						{guidance.muted ? <VolumeOffRounded /> : <VolumeUpRounded />}
					</DriveButton>
				)}
			</CarControls>
		</Box>
	);
}
