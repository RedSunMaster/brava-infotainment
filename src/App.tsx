import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
import { Box, useTheme } from "@mui/material";
import TripInfoCard from "./components/TripInfoCard";
import ConfirmNavDialog from "./components/ConfirmNavDialog";
import { usePositionPuck } from "./hooks/usePuckPosition";
import CarControls from "./components/CarControls";
import { useMapStyle } from "./hooks/useMapStyle";

export default function App() {
	const theme = useTheme();
	const mapContainer = useRef<HTMLDivElement>(null);
	const simIndexRef = useRef(0);
	const lastPosRef = useRef<[number, number]>(DEV_ORIGIN);
	const lastBearingRef = useRef<number>(0);
	const [provider, setProvider] = useState<RoutingProvider>("valhalla");
	const [navActive, setNavActive] = useState(false);
	const [pendingDest, setPendingDest] = useState<{
		coords: [number, number];
		placeName: string;
		duration: string;
		distance: string;
	} | null>(null);
	const { mapRef, mapLoaded } = useMapbox(mapContainer);
	const { coordsRef, maneuversRef, maneuvers, fetchRoute, trimRoute } =
		useRoute(mapRef);
	const { currentStep, setInstruction, onPositionUpdate, resetNavigation } =
		useNavigation(mapRef, maneuversRef, simIndexRef);
	const {
		cameraMode,
		orientation,
		followPosition,
		showOverview,
		resumeFollowing,
		toggleOrientation,
	} = useCameraMode(mapRef);
	const { updatePuck } = usePositionPuck(mapRef, mapLoaded, DEV_ORIGIN);
	const { period } = useMapStyle(mapRef, mapLoaded);
	const trackedPositionUpdate = useCallback(
		async (
			pos: [number, number],
			bearing: number,
			speed: number,
			prov: RoutingProvider,
			followPos: (
				pos: [number, number],
				bearing: number,
				elapsed: number,
			) => void,
		) => {
			lastPosRef.current = pos;
			lastBearingRef.current = bearing;
			updatePuck(pos, bearing);
			trimRoute(simIndexRef.current);
			await onPositionUpdate(pos, bearing, speed, prov, followPos);
		},
		[updatePuck, trimRoute, onPositionUpdate],
	);

	const { startSimulation, stopSimulation } = useSimulation(
		coordsRef,
		simIndexRef,
		trackedPositionUpdate,
		setInstruction,
		followPosition,
	);

	async function handleToggleProvider() {
		setProvider((p) => (p === "mapbox" ? "valhalla" : "mapbox"));
	}

	// Current map bearing for compass needle rotation
	const [mapBearing, setMapBearing] = useState(0);
	useEffect(() => {
		const map = mapRef.current;
		if (!map) return;

		let rafId: number;
		const onMove = () => {
			cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => setMapBearing(map.getBearing())); // ✅ max once per frame
		};

		map.on("move", onMove);
		return () => {
			map.off("move", onMove);
			cancelAnimationFrame(rafId);
		};
	}, [mapLoaded]); // ✅ fix dep — mapRef.current is mutable, shouldn't be a dep

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
		setPendingDest(null);
		setNavActive(true);
		resumeFollowing(lastPosRef.current, lastBearingRef.current);
		startSimulation(provider);
	}

	function handleCancelSearch() {
		setPendingDest(null);
		stopSimulation();
		resetNavigation();
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
	// Add end navigation handler inside App()
	function handleEndNavigation() {
		stopSimulation();
		resetNavigation();
		setNavActive(false);
		// Clear route line from map
		const map = mapRef.current;
		if (map?.getSource("route")) {
			map.removeLayer("route");
			map.removeSource("route");
		}
		map?.easeTo({
			center: lastPosRef.current,
			zoom: ZOOM_LEVEL,
			pitch: 0,
			bearing: 0,
			duration: 800,
		});
		if (map?.getLayer("route-bg")) map.removeLayer("route-bg");
		if (map?.getSource("route-bg")) map.removeSource("route-bg");
	}

	// Add this effect — runs once when map is ready
	useEffect(() => {
		if (!mapLoaded) return;

		async function snapInitialPosition() {
			const snapped = await snapToRoad([DEV_ORIGIN, DEV_ORIGIN], provider);
			lastPosRef.current = snapped;
			updatePuck(snapped, 0);

			// Fly camera to snapped position
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
			}}
		>
			<Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
				{/* Map */}
				<Box
					ref={mapContainer}
					sx={{
						position: "absolute",
						inset: 0,
						borderRadius: "0 0 20px 20px",
						overflow: "hidden",
					}}
				/>

				{/* Top bar — full width, split 50/50 */}
				<Box
					sx={{
						position: "absolute",
						top: 16,
						left: 16,
						right: 16,
						zIndex: 10,
						display: "flex",
						gap: 2,
						alignItems: "flex-start",
					}}
				>
					{/* Left 50% — Navigation card */}
					<Box sx={{ flex: 1, minWidth: 0, zIndex: 1400 }}>
						{navActive && (
							<NavigationCard maneuvers={maneuvers} currentStep={currentStep} />
						)}
					</Box>

					{/* Right 50% — Map controls */}
					<Box
						sx={{
							flex: 1,
							minWidth: 0,
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
							onLocate={() =>
								resumeFollowing(lastPosRef.current, lastBearingRef.current)
							}
							isNavActive={navActive}
							provider={provider}
							onToggleProvider={handleToggleProvider}
						/>
					</Box>
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
					{/* Confirm nav dialog — shown after search select, before nav starts */}
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
				{/* Trip Info */}
				{navActive && (
					<Box
						sx={{
							position: "absolute",
							bottom: 16,
							right: 16,
							zIndex: 10,
						}}
					>
						<TripInfoCard
							maneuvers={maneuvers}
							currentStep={currentStep}
							onEndNav={handleEndNavigation}
						/>
					</Box>
				)}
			</Box>

			{/* Bottom bar */}
			<Box sx={{ height: "100px", flexShrink: 0, background: "black" }}>
				<CarControls />
			</Box>
		</Box>
	);
}
