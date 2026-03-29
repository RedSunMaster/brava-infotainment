import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMapbox } from "./hooks/useMapbox";
import { useRoute } from "./hooks/useRoute";
import { useNavigation } from "./hooks/useNavigation";
import { useSimulation } from "./hooks/useSimulation";
import { useCameraMode } from "./hooks/useCameraMode";
import NavigationCard from "./components/NavigationCard";
import MapControls from "./components/MapControls";
import { snapToRoad } from "./lib/routing";
import {
	DEV_ORIGIN,
	RoutingProvider,
	MAPBOX_TOKEN,
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

export default function App() {
	const theme = useTheme();
	const mapContainer = useRef<HTMLDivElement>(null);
	const simIndexRef = useRef(0);
	const lastPosRef = useRef<[number, number]>(DEV_ORIGIN);
	const lastBearingRef = useRef<number>(0);
	const navDestRef = useRef<[number, number] | null>(null);
	const [provider, setProvider] = useState<RoutingProvider>("mapbox");
	const [navActive, setNavActive] = useState(false);
	const [isRerouting, setIsRerouting] = useState(false);
	const [pendingDest, setPendingDest] = useState<{
		coords: [number, number];
		placeName: string;
		duration: string;
		distance: string;
	} | null>(null);

	const { mapRef, mapLoaded } = useMapbox(mapContainer);
	const {
		coordsRef,
		maneuversRef,
		maneuvers,
		fetchRoute,
		trimRoute,
		trimRouteByDistance,
	} = useRoute(mapRef);

	// ── Camera ───────────────────────────────────────────────────────────────
	const {
		cameraMode,
		orientation,
		followingRef,
		orientationRef,
		showOverview,
		resumeFollowing,
		toggleOrientation,
	} = useCameraMode(mapRef);

	// ── Puck — render loop drives both model and camera ──────────────────────
	const { updatePuck, resetCursor } = usePositionPuck(
		mapRef,
		mapLoaded,
		DEV_ORIGIN,
		coordsRef,
		followingRef,
		orientationRef,
		trimRouteByDistance,
	);

	const { period } = useMapStyle(mapRef, mapLoaded);

	// ── Reroute ──────────────────────────────────────────────────────────────
	const handleOffRoute = useCallback(async () => {
		if (!navDestRef.current || isRerouting) return;
		setIsRerouting(true);
		try {
			await fetchRoute(lastPosRef.current, navDestRef.current, provider);
			simIndexRef.current = 0;
			resetNavigation();
			resumeFollowing();
		} finally {
			setIsRerouting(false);
		}
	}, [fetchRoute, isRerouting, provider]);

	const {
		currentStep,
		instruction,
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

	// ── Position update — no followPos param anymore ─────────────────────────
	const trackedPositionUpdate = useCallback(
		async (
			pos: [number, number],
			bearing: number,
			speed: number,
			prov: RoutingProvider,
		) => {
			lastPosRef.current = pos;
			lastBearingRef.current = bearing;
			updatePuck(pos, bearing, speed);
			await onPositionUpdate(pos, bearing, speed, prov);
		},
		[updatePuck, onPositionUpdate],
	);

	// ── GPS ──────────────────────────────────────────────────────────────────
	const { status: gpsStatus } = useGps(
		useCallback(
			(pos: [number, number], bearing: number, speed: number) => {
				lastPosRef.current = pos;
				lastBearingRef.current = bearing;

				// Always update the puck — render loop decides whether camera follows.
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

	// ── Simulation — followPosition no longer passed ─────────────────────────
	// Note: remove the followPosition param from useSimulation's implementation
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

	async function handleSearchSelect(
		coords: [number, number],
		placeName: string,
	) {
		resetNavigation();
		simIndexRef.current = 0;
		await fetchRoute(lastPosRef.current, coords, provider);
		const fetchedManeuvers = maneuversRef.current;
		if (!fetchedManeuvers.length) return;
		showOverview(coordsRef.current);
		const totalSecs = fetchedManeuvers.reduce(
			(a, m: any) => a + (m.time ?? 0),
			0,
		);
		const totalKm = fetchedManeuvers.reduce(
			(a, m: any) => a + (m.length ?? 0),
			0,
		);
		const hrs = Math.floor(totalSecs / 3600);
		const mins = Math.round((totalSecs % 3600) / 60);
		setPendingDest({
			coords,
			placeName,
			duration: hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`,
			distance:
				totalKm >= 1
					? `${totalKm.toFixed(1)} km`
					: `${Math.round(totalKm * 1000)} m`,
		});
	}

	function handleConfirmNav() {
		if (!pendingDest) return;
		navDestRef.current = pendingDest.coords;
		setPendingDest(null);
		setNavActive(true);
		resumeFollowing();
		if (gpsStatus !== "fix") {
			startSimulation(provider);
		}
	}

	function handleCancelSearch() {
		setPendingDest(null);
		stopSimulation();
		resetNavigation();
		resetCursor();
		navDestRef.current = null;
		const map = mapRef.current;
		if (map?.getLayer("route")) map.removeLayer("route");
		if (map?.getSource("route")) map.removeSource("route");
		if (map?.getLayer("route-bg")) map.removeLayer("route-bg");
		if (map?.getSource("route-bg")) map.removeSource("route-bg");
		map?.easeTo({
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
		setNavActive(false);
		setIsRerouting(false);
		navDestRef.current = null;
		const map = mapRef.current;
		if (map?.getSource("route")) {
			map.removeLayer("route");
			map.removeSource("route");
		}
		if (map?.getLayer("route-bg")) map.removeLayer("route-bg");
		if (map?.getSource("route-bg")) map.removeSource("route-bg");
		map?.easeTo({
			center: lastPosRef.current,
			zoom: ZOOM_LEVEL,
			pitch: 0,
			bearing: 0,
			duration: 800,
		});
	}, [mapRef, resetNavigation, resetCursor, stopSimulation]);

	useEffect(() => {
		if (navActive && maneuvers.length > 0 && currentStep >= maneuvers.length) {
			handleEndNavigation();
		}
	}, [currentStep, maneuvers.length, navActive, handleEndNavigation]);

	function handleLocate() {
		resumeFollowing(); // re-enables following; render loop takes over next frame
	}

	useEffect(() => {
		if (!mapLoaded) return;
		async function snapInitialPosition() {
			const snapped = await snapToRoad([DEV_ORIGIN, DEV_ORIGIN], provider);
			lastPosRef.current = snapped;
			updatePuck(snapped, 0, 0);
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
				background: "black",
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
										size="small"
										sx={{
											alignSelf: "flex-start",
											background: alpha(theme.palette.background.default, 0.9),
											backdropFilter: "blur(10px)",
											border: `1px solid ${alpha(theme.palette.warning.main, 0.4)}`,
											color: theme.palette.warning.main,
											fontWeight: 600,
											fontSize: 12,
											boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
										}}
									/>
								)}
								<Box sx={{ display: "flex", justifyContent: "flex-end" }}>
									<MapControls
										cameraMode={cameraMode}
										orientation={orientation}
										hasRoute={maneuvers.length > 0}
										currentBearing={mapBearing}
										currentPosition={lastPosRef.current}
										mapboxToken={process.env.MAPBOX_TOKEN}
										onOverview={() => showOverview(coordsRef.current)}
										onToggleOrientation={() =>
											toggleOrientation(lastBearingRef.current)
										}
										onSearchSelect={handleSearchSelect}
										onLocate={handleLocate}
										isNavActive={navActive}
										provider={provider}
										onToggleProvider={handleToggleProvider}
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
										toggleOrientation(lastBearingRef.current)
									}
									onSearchSelect={handleSearchSelect}
									onLocate={handleLocate}
									isNavActive={navActive}
									provider={provider}
									onToggleProvider={handleToggleProvider}
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
							onConfirm={handleConfirmNav}
							onCancel={handleCancelSearch}
						/>
					)}
				</Box>

				{navActive && (
					<Box sx={{ position: "absolute", bottom: 16, right: 16, zIndex: 10 }}>
						<TripInfoCard
							maneuvers={maneuvers}
							currentStep={currentStep}
							onEndNav={handleEndNavigation}
						/>
					</Box>
				)}
			</Box>

			<Box sx={{ height: "100px", flexShrink: 0, background: "black" }}>
				<CarControls />
			</Box>
		</Box>
	);
}
