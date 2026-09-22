import React, { useCallback, useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import { useMapbox } from "./hooks/useMapbox";
import { useRoute } from "./hooks/useRoute";
import { useNavigation } from "./hooks/useNavigation";
import { useSimulation } from "./hooks/useSimulation";
import { useCameraMode } from "./hooks/useCameraMode";
import NavigationCard from "./components/NavigationCard";
import MapControls from "./components/MapControls";
import { getRoute, snapToRoad, type NormalizedManeuver } from "./lib/routing";
import {
	DEV_ORIGIN,
	RoutingProvider,
	ZOOM_LEVEL,
} from "./constants";
import { Box, Chip, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import TripInfoCard from "./components/TripInfoCard";
import ConfirmNavDialog from "./components/ConfirmNavDialog";
import { usePositionPuck } from "./hooks/usePuckPosition";
import CarControls from "./components/CarControls";
import { useMapStyle } from "./hooks/useMapStyle";
import { useGps } from "./hooks/useGps";
import ClockWeatherChip from "./components/ClockWeatherChip";
import SyncRoundedIcon from "@mui/icons-material/SyncRounded";
import { useThemeMode } from "./ThemeContext";

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
	if (/poi|place|transit|airport|parking|school|hospital|park|shop/.test(layerId)) {
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
	const theme = useTheme();
	const { mode } = useThemeMode();
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
	const [navCardExpanded, setNavCardExpanded] = useState(false);
	const [isRerouting, setIsRerouting] = useState(false);
	const [vehicleSpeedMs, setVehicleSpeedMs] = useState(0);
	const [pendingDest, setPendingDest] = useState<{
		coords: [number, number];
		placeName: string;
		duration: string;
		distance: string;
		action: PendingNavAction;
	} | null>(null);

	const { mapRef, mapLoaded } = useMapbox(mapContainer);
	const isDriving = vehicleSpeedMs > 1;
	const {
		coordsRef,
		maneuversRef,
		maneuvers,
		fetchRoute,
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

	useMapStyle(mapRef, mapLoaded, mode, () => {
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
			lastBearingRef.current = bearing;
			lastSpeedRef.current = speed;
			setVehicleSpeedMs(speed);
			updatePuck(pos, bearing, speed);
			await onPositionUpdate(pos, bearing, speed, prov);
		},
		[updatePuck, onPositionUpdate],
	);

	// ── GPS ────────────────────────────────────────────────────────────────────
	const { status: gpsStatus } = useGps(
		useCallback(
			(pos: [number, number], bearing: number, speed: number) => {
				lastPosRef.current = pos;
				lastBearingRef.current = bearing;
				lastSpeedRef.current = speed;
				setVehicleSpeedMs(speed);

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
			resetNavigation();
			simIndexRef.current = 0;
			await fetchRoute(lastPosRef.current, coords, provider);
			syncPuck(lastPosRef.current, lastBearingRef.current, lastSpeedRef.current);
			const fetchedManeuvers = maneuversRef.current;
			if (!fetchedManeuvers.length) return;
			showOverview(coordsRef.current);
			const summary = summarizeManeuvers(fetchedManeuvers);
			setPendingDest({
				coords,
				placeName,
				duration: summary.duration,
				distance: summary.distance,
				action: "destination",
			});
		},
		[coordsRef, fetchRoute, maneuversRef, provider, resetNavigation, showOverview],
	);

	const handleAddStopSelect = useCallback(
		async (coords: [number, number], placeName: string) => {
			if (!navDestRef.current) return;
			const route = await getRoute(
				lastPosRef.current,
				navDestRef.current,
				provider,
				[coords],
			);
			const summary = summarizeManeuvers(route.maneuvers);
			setPendingDest({
				coords,
				placeName,
				duration: summary.duration,
				distance: summary.distance,
				action: "stop",
			});
		},
		[provider],
	);

	useEffect(() => {
		const map = mapRef.current;
		if (!mapLoaded || !map) return;

		const handleMapClick = async (event: mapboxgl.MapMouseEvent) => {
			if (destinationClickInFlightRef.current) return;
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
				if (navActive) {
					await handleAddStopSelect(destination.coords, destination.placeName);
				} else {
					await handleSearchSelect(destination.coords, destination.placeName);
				}
			} finally {
				destinationClickInFlightRef.current = false;
			}
		};

		map.on("click", handleMapClick);
		return () => {
			map.off("click", handleMapClick);
		};
	}, [handleAddStopSelect, handleSearchSelect, mapLoaded, mapRef, navActive]);

	async function handleConfirmNav() {
		if (!pendingDest) return;
		if (pendingDest.action === "stop") {
			if (!navDestRef.current) return;
			const nextStops = [pendingDest.coords];
			await fetchRoute(
				lastPosRef.current,
				navDestRef.current,
				provider,
				nextStops,
			);
			syncPuck(lastPosRef.current, lastBearingRef.current, lastSpeedRef.current);
			navStopsRef.current = nextStops;
			setPendingDest(null);
			resetNavigation();
			resetCursor();
			simIndexRef.current = 0;
			resumeFollowing();
			if (gpsStatus !== "fix") {
				startSimulation(provider);
			}
			return;
		}
		navDestRef.current = pendingDest.coords;
		navStopsRef.current = [];
		setPendingDest(null);
		setNavActive(true);
		resumeFollowing();
		if (gpsStatus !== "fix") {
			startSimulation(provider);
		}
	}

	function handleCancelSearch() {
		if (pendingDest?.action === "stop") {
			setPendingDest(null);
			return;
		}
		setPendingDest(null);
		stopSimulation();
		resetNavigation();
		resetCursor();
		navDestRef.current = null;
		navStopsRef.current = [];
		simIndexRef.current = 0;
		clearRoute();
		mapRef.current?.easeTo({
			center: lastPosRef.current,
			zoom: ZOOM_LEVEL,
			pitch: 0,
			bearing: 0,
			duration: 600,
		});
	}

	const handleEndNavigation = useCallback(() => {
		stopSimulation();
		resetNavigation();
		resetCursor();
		setVehicleSpeedMs(0);
		lastSpeedRef.current = 0;
		setNavActive(false);
		setNavCardExpanded(false);
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
	]);

	useEffect(() => {
		if (navActive && maneuvers.length > 0 && currentStep >= maneuvers.length) {
			handleEndNavigation();
		}
	}, [currentStep, maneuvers.length, navActive, handleEndNavigation]);

	useEffect(() => {
		if (!navActive) setNavCardExpanded(false);
	}, [navActive]);

	// ── Locate button ───────────────────────────────────────────────────────────
	// resumeFollowing() updates React cameraMode state + followingRef immediately.
	// smoothLocate() then animates back with easeTo and holds the jumpTo lock for
	// 900ms so the animation isn't interrupted and the map stays interactive.
	function handleLocate() {
		resumeFollowing();
		smoothLocate(lastPosRef.current, lastBearingRef.current);
	}

	useEffect(() => {
		if (!mapLoaded) return;
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
		snapInitialPosition();
	}, [mapLoaded]);

	return (
		<Box
			sx={{
				background: theme.palette.background.default,
				height: "100vh",
				width: "100vw",
				display: "flex",
				flexDirection: "column",
				position: "fixed",
				top: 0,
				left: 0,
				padding: "10px",
			}}
		>
			<Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
				<Box
					ref={mapContainer}
					sx={{
						position: "absolute",
						inset: 0,
						borderRadius: "10px",
						overflow: "hidden",
					}}
				/>

				{/* Top HUD */}
				<Box
					sx={{
						position: "absolute",
						top: 16,
						left: 16,
						right: 16,
						zIndex: 10,
						pointerEvents: "none",
					}}
				>
					{navActive ? (
						<Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
							<Box sx={{ pointerEvents: "auto", flexShrink: 0 }}>
								<ClockWeatherChip
									position={lastPosRef.current}
									gpsStatus={gpsStatus}
								/>
							</Box>
							<Box
								sx={{
									flex: 1,
									minWidth: 0,
									display: "flex",
									flexDirection: "column",
									gap: 1,
									pointerEvents: "auto",
								}}
							>
								<NavigationCard
									maneuvers={maneuvers}
									currentStep={currentStep}
									distanceToNextM={distanceToNextM}
									timeToNextS={timeToNextS}
									isDriving={isDriving}
									onExpandedChange={setNavCardExpanded}
								/>
								{isRerouting && (
									<Chip
										icon={
											<SyncRoundedIcon
												sx={{
													fontSize: 16,
													animation: "spin 1s linear infinite",
													"@keyframes spin": {
														from: { transform: "rotate(0deg)" },
														to: { transform: "rotate(360deg)" },
													},
												}}
											/>
										}
										label="Rerouting…"
										size="medium"
										sx={{
											alignSelf: "flex-start",
											background: alpha(theme.palette.background.default, 0.9),
											backdropFilter: "blur(10px)",
											border: `1px solid ${alpha(theme.palette.warning.main, 0.4)}`,
											color: theme.palette.warning.main,
											fontWeight: 800,
											fontSize: 14,
											minHeight: 42,
											boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
										}}
									/>
								)}
								<Box
									sx={{
										display: "flex",
										justifyContent: "flex-end",
										mt: navCardExpanded ? 2 : 0,
										transition: "margin-top 180ms ease",
									}}
								>
									<MapControls
										cameraMode={cameraMode}
										orientation={orientation}
										hasRoute={maneuvers.length > 0}
										currentBearing={mapBearing}
										currentPosition={lastPosRef.current}
										mapboxToken={process.env.MAPBOX_TOKEN}
										onOverview={() => showOverview(coordsRef.current)}
										onToggleOrientation={() =>
											toggleOrientation(
												lastBearingRef.current,
												lastPosRef.current,
											)
										}
										onSearchSelect={handleSearchSelect}
										onLocate={handleLocate}
										isNavActive={navActive}
										provider={provider}
										onToggleProvider={handleToggleProvider}
										isDriving={isDriving}
									/>
								</Box>
							</Box>
						</Box>
					) : (
						<Box
							sx={{
								display: "grid",
								gridTemplateColumns: "1fr auto 1fr",
								alignItems: "flex-start",
								gap: 2,
							}}
						>
							<Box />
							<Box sx={{ pointerEvents: "auto" }}>
								<ClockWeatherChip
									position={lastPosRef.current}
									gpsStatus={gpsStatus}
								/>
							</Box>
							<Box
								sx={{
									pointerEvents: "auto",
									display: "flex",
									justifyContent: "flex-end",
								}}
							>
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
									onLocate={handleLocate}
									isNavActive={navActive}
									provider={provider}
									onToggleProvider={handleToggleProvider}
									isDriving={isDriving}
								/>
							</Box>
						</Box>
					)}
				</Box>

				<Box
					sx={{
						position: "absolute",
						bottom: 16,
						left: "50%",
						transform: "translateX(-50%)",
						zIndex: 20,
					}}
				>
					{pendingDest && (
						<ConfirmNavDialog
							placeName={pendingDest.placeName}
							duration={pendingDest.duration}
							distance={pendingDest.distance}
							confirmLabel={
								pendingDest.action === "stop" ? "Add stop" : "Take me there"
							}
							onConfirm={handleConfirmNav}
							onCancel={handleCancelSearch}
						/>
					)}
				</Box>

				{navActive && (
					<Box sx={{ position: "absolute", bottom: 10, right: 14, zIndex: 10 }}>
						<TripInfoCard
							maneuvers={maneuvers}
							currentStep={currentStep}
							onEndNav={handleEndNavigation}
							isDriving={isDriving}
						/>
					</Box>
				)}
			</Box>

			<Box
				sx={{
					height: "140px",
					flexShrink: 0,
					background: theme.palette.background.paper,
				}}
			>
				<CarControls isDriving={isDriving} />
			</Box>
		</Box>
	);
}
