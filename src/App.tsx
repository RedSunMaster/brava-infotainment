import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import mapboxgl from "mapbox-gl";
import { alpha, type Theme } from "@mui/material/styles";
import { useMapOcclusion } from "./hooks/useMapOcclusion";
import { useMapbox } from "./hooks/useMapbox";
import { useDestinationHighlight } from "./hooks/useDestinationHighlight";
import { useRoute } from "./hooks/useRoute";
import { useNavigation } from "./hooks/useNavigation";
import { useSimulation } from "./hooks/useSimulation";
import { useCameraMode } from "./hooks/useCameraMode";
import NavigationCard from "./components/NavigationCard";
import MapControls from "./components/MapControls";
import {
	getRoute,
	getRoutes,
	type NormalizedManeuver,
	type NormalizedRoute,
	type RoutePreference,
} from "./lib/routing";
import { DEV_ORIGIN, RoutingProvider } from "./constants";
import { Alert, Box, Typography } from "@mui/material";
import TripInfoCard from "./components/TripInfoCard";
import ConfirmNavDialog from "./components/ConfirmNavDialog";
import RouteAlerts from "./components/RouteAlerts";
import QuickStops from "./components/QuickStops";
import FasterRouteOffer from "./components/FasterRouteOffer";
import { describeSaving, findFasterRoute, remainingSeconds, routeSeconds, type FasterRoute } from "./lib/fasterRoute";
import { useTrafficLayer } from "./hooks/useTrafficLayer";
import { isSignificantTurn } from "./lib/cameraLookAhead";
import { buildRouteAlerts, HAZARD_ALERT_M } from "./lib/routeAlerts";
import { routeLineMetrics } from "./lib/routeLine";
import { usePositionPuck } from "./hooks/usePuckPosition";
import CarControls from "./components/CarControls";
import { useMapStyle } from "./hooks/useMapStyle";
import { useGps } from "./hooks/useGps";
import { isUsableMapPoint } from "./lib/mapTapZone";
import { useKeyboard } from "./contexts/KeyboardContext";
import { locateOnRoute, routeCache } from "./lib/routeLocate";
import { useDeadReckoning } from "./hooks/useDeadReckoning";
import type { LastFix } from "./lib/deadReckoning";
import SpeedSigns from "./components/SpeedSigns";
import { limitAt, speedSignState } from "./lib/speedSigns";
import ClockWeatherChip from "./components/ClockWeatherChip";
import PhoneNotifications from "./components/PhoneNotifications";
import ProfileDialog from "./components/ProfileDialog";
import { SIDE_DOCK_WIDTH, isDockSide } from "./lib/dockLayout";
import lightsUrl from "../public/textures/city-lights.webp";
import { useCameraPadding } from "./hooks/useCameraPadding";
import { useGlobeShowcase } from "./hooks/useGlobeShowcase";
import { useSplash } from "./hooks/useSplash";
import { wantsLocation } from "./lib/showcase";
import { CLOUDS_KEY, NIGHT_KEY, applyNight, presetFor, setCloudsVisible, setLightPreset } from "./lib/mapStyle";
import { useThemeMode } from "./ThemeContext";
import DriveButton from "./components/DriveButton";
import { recordFrequentPlace } from "./lib/frequentPlaces";
import { readSavedPlaces, savePlace, setPlaceMarker, defaultMarker, type PlaceTarget } from "./lib/savedPlaces";
import { readFavourites, addFavourite, removeFavourite, setFavouriteMarker, nextMarker } from "./lib/favourites";
import { useRouteHazards } from "./hooks/useRouteHazards";
import { useExploration } from "./hooks/useExploration";
import { useDrives } from "./hooks/useDrives";
import { PACMAN_GHOSTS_KEY, PACMAN_REGROW_KEY, PACMAN_SOUND_KEY, isSoundSetting, usePacman } from "./hooks/usePacman";
import { GAME_MODE_KEY, initialGameMode, isGameMode, type GameMode } from "./lib/gameModes";
import { DEFAULT_REGROW, isRegrow } from "./lib/pacman";
import GameModesPanel from "./components/GameModesPanel";
import PacmanPanel from "./components/PacmanPanel";
import PacmanHud from "./components/PacmanHud";
import DriveHud from "./components/DriveHud";
import { GhostPanel, TripsPanel } from "./components/DrivePanels";
import { useTopDownLock } from "./hooks/useTopDownLock";
import { useProfiles } from "./contexts/ProfileContext";
import DiscoveryNotices from "./components/DiscoveryNotices";
import ExplorePanel from "./components/ExplorePanel";

import { usePersistentState, isBool } from "./lib/usePersistentState";
import { distanceKm, placeDetails, fetchPlaceDetails, sameBusinessName, type PlaceDetails } from "./lib/locationSearch";
import QuickDestinations from "./components/QuickDestinations";
import FlagRounded from "@mui/icons-material/FlagRounded";
import VisibilityOffRounded from "@mui/icons-material/VisibilityOffRounded";
import VisibilityRounded from "@mui/icons-material/VisibilityRounded";
import { useSpokenNavigation, type GuidanceStep } from "./hooks/useSpokenNavigation";
import { kokoroVoice } from "./lib/kokoroVoice";
import {
	nextDrivingState,
	interactionLocked,
	type DrivingState,
} from "./lib/drivingState";

interface ClickDestination {
	coords: [number, number];
	placeName: string;
	details?: PlaceDetails;
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
	name?: string,
): Promise<ClickDestination> {
	const token = process.env.MAPBOX_TOKEN;
	if (!token) {
		return { coords, placeName: "Dropped pin" };
	}

	try {
		const [lng, lat] = coords;
		const params = new URLSearchParams({ longitude: String(lng), latitude: String(lat), limit: "10", access_token: token });
		const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/reverse?${params}`, { signal: AbortSignal.timeout(8000) });
		if (!res.ok) throw new Error("Lookup unavailable");
		const data = await res.json();
		const feature = name ? data.features?.find((item: any) => item.properties?.feature_type === "poi" && typeof item.properties?.name === "string" && sameBusinessName(item.properties.name, name)) : data.features?.[0];
		if (!feature) return { coords, placeName: name ?? "Dropped pin" };
		let details = placeDetails(feature.properties);
		if (feature.properties?.feature_type === "poi" && details.mapboxId) {
			try { const rich = await fetchPlaceDetails(details.mapboxId, token, new AbortController().signal); details = { ...details, ...Object.fromEntries(Object.entries(rich).filter(([, value]) => value != null)) }; } catch { /* Keep the basic search data. */ }
		}
		return {
			coords,
			placeName: feature?.properties?.name ?? "Dropped pin",
			details,
		};
	} catch {
		return { coords, placeName: name ?? "Dropped pin" };
	}
}

/** How much longer the trip gets when a stop is added, versus what is left of the current route. */
function detourLabel(next: NormalizedManeuver[], remaining: NormalizedManeuver[]) {
	const total = (steps: NormalizedManeuver[], key: "time" | "length") => steps.reduce((sum, step) => sum + (step[key] ?? 0), 0);
	const minutes = Math.round((total(next, "time") - total(remaining, "time")) / 60);
	const km = total(next, "length") - total(remaining, "length");
	if (minutes <= 0) return km < 0.3 ? "No detour" : `+${km.toFixed(1)} km`;
	return `+${minutes} min detour`;
}

/** Seconds until you reach the place being previewed: the whole trip, or just up to a newly added stop. */
function secondsToPlace(route: NormalizedRoute, action: PendingNavAction, stopCount: number): number | undefined {
	if (action === "stop") return route.legSeconds ? route.legSeconds.slice(0, stopCount).reduce((sum, value) => sum + value, 0) : undefined;
	return route.legSeconds ? route.legSeconds.reduce((sum, value) => sum + value, 0) : route.maneuvers.reduce((sum, step) => sum + (step.time ?? 0), 0);
}

function summarizeManeuvers(maneuvers: NormalizedManeuver[]) {
	const totalSecs = maneuvers.reduce((a, m) => a + (m.time ?? 0), 0);
	const totalKm = maneuvers.reduce((a, m) => a + (m.length ?? 0), 0);
	const hrs = Math.floor(totalSecs / 3600);
	const mins = Math.round((totalSecs % 3600) / 60);
	return {
		seconds: totalSecs,
		km: totalKm,
		duration: hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`,
		distance:
			totalKm >= 1
				? `${totalKm.toFixed(1)} km`
				: `${Math.round(totalKm * 1000)} m`,
	};
}

/** A round map pin showing an emoji, used for saved places and for cameras and hazards. */
function pinElement(symbol: string, ring: string, onTap: () => void): HTMLDivElement {
	const el = document.createElement("div");
	el.textContent = symbol;
	Object.assign(el.style, { width: "44px", height: "44px", borderRadius: "50%", background: "#fff", border: `3px solid ${ring}`, boxShadow: "0 2px 6px rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", cursor: "pointer" });
	// Keep taps on a pin to the pin: otherwise the map underneath treats it as a tap or a press-and-hold on the map and picks a destination.
	el.addEventListener("click", onTap);
	for (const type of ["click", "dblclick", "mousedown", "mouseup", "touchstart", "touchend", "pointerdown", "pointerup", "contextmenu"]) el.addEventListener(type, event => event.stopPropagation());
	return el;
}

export default function App() {
	const { period, weather, weatherAppearance, updatePosition } = useThemeMode();
	const kokoroStatus = useSyncExternalStore(kokoroVoice.subscribe, () => kokoroVoice.status);
	const mapContainer = useRef<HTMLDivElement>(null);
	const [turnsSlot, setTurnsSlot] = useState<HTMLElement | null>(null);
	const simIndexRef = useRef(0);
	const lastPosRef = useRef<[number, number]>(DEV_ORIGIN);
	const lastBearingRef = useRef<number>(0);
	const lastSpeedRef = useRef<number>(0);
	// Nearest route vertex to a position, searched near the last known place first so a route that
	// passes the same spot twice cannot make progress (or the speed limit) jump to the other pass.
	const routeDistances = useRef(routeCache()).current;
	const routeHintRef = useRef(0);
	const closestRouteIndex = useCallback((pos: [number, number], coords: [number, number][]): number => {
		const located = locateOnRoute(coords, routeDistances(coords), pos, routeHintRef.current);
		routeHintRef.current = located.segment;
		return located.t >= 0.5 ? Math.min(coords.length - 1, located.segment + 1) : located.segment;
	}, [routeDistances]);
	// The last position that really came from the GPS receiver (not simulated or estimated).
	const lastFixRef = useRef<LastFix | null>(null);
	const navDestRef = useRef<[number, number] | null>(null);
	const navBuildingRef = useRef<[number, number] | null>(null);
	const navStopsRef = useRef<[number, number][]>([]);
	const destinationClickInFlightRef = useRef(false);
	const [provider, setProvider] = useState<RoutingProvider>("mapbox");
	const [openPanel, setOpenPanel] = useState<"search" | "settings" | "media" | "climate" | null>(null);
	const [stopCategory, setStopCategory] = useState<string | null>(null);
	useEffect(() => { if (openPanel !== "search") setStopCategory(null); }, [openPanel]);
	const [navActive, setNavActive] = useState(false);
	const [navToolsOpen, setNavToolsOpen] = useState(false);
	const { hideKeyboard } = useKeyboard();
	// Whether any menu is open, and how to close them all: read by the map's tap handler.
	const menuRef = useRef({ open: false, close: () => {} });
	menuRef.current = { open: openPanel !== null || navToolsOpen, close: () => { setOpenPanel(null); setNavToolsOpen(false); hideKeyboard(); } };
	const previewMode =
		new URLSearchParams(window.location.search).get("preview") ===
		"car-portrait";
	const [drivingState, setDrivingState] = useState<DrivingState>("unknown");
	const [routeError, setRouteError] = useState<string | null>(null);
	const [savedPlaces, setSavedPlaces] = useState(readSavedPlaces);
	// Set while the search panel is choosing the Home or Work address.
	const [placeSlot, setPlaceSlot] = useState<PlaceTarget | null>(null);
	const [favourites, setFavourites] = useState(readFavourites);
	const [profilesOpen, setProfilesOpen] = useState(false);
	const [phoneOpen, setPhoneOpen] = useState(false);
	// Clear view: just the map and, if navigating, the guidance. Not remembered, so the car never starts with its controls hidden.
	const [clearView, setClearView] = useState(false);
	const enterClearView = useCallback(() => { setOpenPanel(null); setPhoneOpen(false); setProfilesOpen(false); setDockEditing(false); setClearView(true); }, []);
	const [dockEditing, setDockEditing] = useState(false);
	const [showClouds, setShowClouds] = usePersistentState(CLOUDS_KEY, true, isBool);
	const [showNight, setShowNight] = usePersistentState(NIGHT_KEY, true, isBool);
	const [globeIdle, setGlobeIdle] = usePersistentState("brava-globe-idle", true, isBool);
	const [dockSide, setDockSide] = usePersistentState("brava-dock-side", "bottom" as "bottom" | "left" | "right", isDockSide);
	// Everything that is not the dock keeps clear of a dock at the left or right edge.
	const insetLeft = 24 + (dockSide === "left" ? SIDE_DOCK_WIDTH : 0);
	const insetRight = 24 + (dockSide === "right" ? SIDE_DOCK_WIDTH : 0);
	const [hazardAlerts, setHazardAlerts] = usePersistentState("brava-hazard-alerts", true, isBool);
	const [arrivedAt, setArrivedAt] = useState<string | null>(null);
	const navDestNameRef = useRef<string | null>(null);
	// True while the latest raw position is within 30 m of the end of the route.
	const [nearRouteEnd, setNearRouteEnd] = useState(false);
	const [routeBusy, setRouteBusy] = useState(false);
	const [selectingBuilding, setSelectingBuilding] = useState<[number, number] | null>(null);
	const routeRequest = useRef(0);
	const [isRerouting, setIsRerouting] = useState(false);
	const [vehicleSpeedMs, setVehicleSpeedMs] = useState(0);
	const [activeRoute, setActiveRoute] = useState<NormalizedRoute | null>(null);
	const [routePosition, setRoutePosition] = useState(0);
	const activeRouteRef = useRef<NormalizedRoute | null>(null);
	activeRouteRef.current = activeRoute;
	const [trafficStale, setTrafficStale] = useState(false);
	const trafficMisses = useRef(0);
	const [routePreferences, setRoutePreferences] = useState<RoutePreference[]>(() => {
		try { const saved = JSON.parse(localStorage.getItem("brava-route-preferences") ?? "[]"); return Array.isArray(saved) ? saved.filter(value => ["toll", "ferry", "unpaved"].includes(value)) : []; } catch { return []; }
	});
	useEffect(() => { try { localStorage.setItem("brava-route-preferences", JSON.stringify(routePreferences)); } catch { /* Keep preferences for this session. */ } }, [routePreferences]);
	const [pendingDest, setPendingDest] = useState<{
		coords: [number, number];
		buildingCoords: [number, number];
		placeName: string;
		details?: PlaceDetails;
		duration: string;
		distance: string;
		action: PendingNavAction;
		route: NormalizedRoute;
		routes: NormalizedRoute[];
		stops: [number, number][];
	} | null>(null);

	const { mapRef, mapLoaded } = useMapbox(mapContainer);
	useSplash(mapLoaded);
	// Explore mode: fog of war over everywhere this profile has not driven.
	const { active: activeProfile } = useProfiles();
	// One game mode at a time. Fog of War was a switch before there were modes, so that switch carries over.
	const [gameMode, setGameMode] = usePersistentState<GameMode>(GAME_MODE_KEY, initialGameMode((() => { try { return localStorage; } catch { return null; } })()), isGameMode);
	const fogOn = gameMode === "fog";
	const pacmanOnRef = useRef(false);
	pacmanOnRef.current = gameMode === "pacman";
	const [pacmanRegrow, setPacmanRegrow] = usePersistentState(PACMAN_REGROW_KEY, DEFAULT_REGROW, isRegrow);
	// The route line on the map (set once useRoute below exists) always shows through the fog.
	const fogRouteRef = useRef<() => [number, number][] | null>(() => null);
	// The car (set once usePositionPuck below exists), and how much fog covers it on screen: it then shows as an outline.
	const fogPuckRef = useRef<() => [number, number] | null>(() => null);
	const puckFogRef = useRef(0);
	const explore = useExploration(mapRef, mapLoaded, activeProfile.id, fogOn, process.env.MAPBOX_TOKEN, fogRouteRef, fogPuckRef, puckFogRef);
	const [pacmanGhosts, setPacmanGhosts] = usePersistentState(PACMAN_GHOSTS_KEY, true, isBool);
	const [pacmanSound, setPacmanSound] = usePersistentState<"off" | "quiet" | "normal">(PACMAN_SOUND_KEY, "normal", isSoundSetting);
	const pacman = usePacman(mapRef, mapLoaded, activeProfile.id, gameMode === "pacman", pacmanRegrow, fogPuckRef, pacmanGhosts, pacmanSound);
	// Pac-Man is played from straight above; the map can still be turned by hand.
	useTopDownLock(mapRef, mapLoaded, gameMode === "pacman");
	// Every real or simulated fix goes to Fog of War's map (always) and to Pac-Man (which eats dots only while it is the mode).
	// Trips: every drive is recorded and scored, whichever mode is on. The ghost is only drawn in Ghost Race.
	const driveLimitRef = useRef<() => number | null>(() => null);
	const driveDestinationRef = useRef<() => [number, number] | null>(() => navDestRef.current);
	const [smoothHud, setSmoothHud] = usePersistentState("brava-smooth-hud", true, isBool);
	const drives = useDrives(mapRef, mapLoaded, activeProfile.id, gameMode === "ghost", driveLimitRef, driveDestinationRef);
	const exploreFix = explore.recordFix, pacmanFix = pacman.recordFix, driveFix = drives.recordFix;
	const recordExploreFix = useCallback((pos: [number, number], speed: number, bearing: number | null) => { exploreFix(pos); pacmanFix(pos); driveFix(pos, speed, bearing); }, [exploreFix, pacmanFix, driveFix]);
	const [showTraffic, setShowTraffic] = useState(() => { try { return localStorage.getItem("brava-show-traffic") !== "off"; } catch { return true; } });
	useEffect(() => { try { localStorage.setItem("brava-show-traffic", showTraffic ? "on" : "off"); } catch { /* Keep the choice for this session. */ } }, [showTraffic]);
	useTrafficLayer(mapRef, mapLoaded, showTraffic, navActive || !!pendingDest);
	const routeMeters = useMemo(() => routeLineMetrics(activeRoute?.coords ?? []).meters, [activeRoute?.coords]);
	const routeHazards = useRouteHazards(activeRoute?.coords, hazardAlerts);
	const routeAlerts = useMemo(() => activeRoute ? buildRouteAlerts({ incidents: activeRoute.incidents, closures: activeRoute.closures, hazards: routeHazards, trafficDelaySeconds: activeRoute.trafficDelaySeconds, meters: routeMeters, position: routePosition, stale: trafficStale }) : [], [activeRoute, routeMeters, routePosition, trafficStale, routeHazards]);
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !mapLoaded || !activeRoute) return;
		const markers = (activeRoute.incidents ?? []).filter(item => item.index >= routePosition && activeRoute.coords[item.index]).map(item => {
			const marker = new mapboxgl.Marker({ color: "#e65100" }).setLngLat(activeRoute.coords[item.index]).setPopup(new mapboxgl.Popup().setText(item.description)).addTo(map);
			marker.getElement().setAttribute("aria-label", `Traffic incident: ${item.description}`);
			return marker;
		});
		for (const closure of activeRoute.closures ?? []) {
			if (closure.end < routePosition || !activeRoute.coords[closure.start]) continue;
			const marker = new mapboxgl.Marker({ color: "#c62828" }).setLngLat(activeRoute.coords[closure.start]).setPopup(new mapboxgl.Popup().setText("Road closure on route")).addTo(map);
			marker.getElement().setAttribute("aria-label", "Road closure on route");
			markers.push(marker);
		}
		return () => markers.forEach(marker => marker.remove());
	}, [mapLoaded, activeRoute, routePosition]);
	// Hazard pins are made once per route and removed as the car passes them, not rebuilt on every position update.
	const hazardPins = useRef(new Map<string, mapboxgl.Marker>());
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !mapLoaded || !activeRoute) return;
		const pins = hazardPins.current;
		for (const item of routeHazards) {
			const marker = new mapboxgl.Marker({ element: pinElement(item.kind === "hazard" || item.kind === "level_crossing" ? "\u26A0\uFE0F" : "\uD83D\uDCF7", "#f59e0b", () => marker.togglePopup()) }).setLngLat(item.coords).setPopup(new mapboxgl.Popup().setText(item.label)).addTo(map);
			marker.getElement().setAttribute("aria-label", item.label);
			pins.set(item.id, marker);
		}
		return () => { pins.forEach(marker => marker.remove()); pins.clear(); };
	}, [mapLoaded, activeRoute, routeHazards]);
	useEffect(() => {
		for (const item of routeHazards) {
			if (item.index >= routePosition) continue;
			hazardPins.current.get(item.id)?.remove();
			hazardPins.current.delete(item.id);
		}
	}, [routePosition, routeHazards]);
	// Tapping a pin starts navigation there, but only while parked and idle, like the Home and Work buttons.
	const goToPlaceRef = useRef<(coords: [number, number], name: string, building?: [number, number]) => void>(() => {});
	goToPlaceRef.current = (coords, name, building) => { if (!navActive && !routeBusy) handleQuickDestination(coords, name, building); };
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !mapLoaded) return;
		const places = [
			...(["home", "work"] as const).flatMap(slot => savedPlaces[slot] ? [{ key: slot, name: savedPlaces[slot]!.name, label: slot === "home" ? "Home" : "Work", marker: savedPlaces[slot]!.marker ?? defaultMarker(slot), coords: savedPlaces[slot]!.coords, building: savedPlaces[slot]!.buildingCoords }] : []),
			...favourites.map(item => ({ key: item.id, name: item.name, label: "Favourite", marker: item.marker, coords: item.coords, building: item.buildingCoords })),
		];
		const markers = places.map(place => {
			const marker = new mapboxgl.Marker({ element: pinElement(place.marker, "#2563eb", () => goToPlaceRef.current(place.coords, place.name, place.building)) }).setLngLat(place.building ?? place.coords).addTo(map);
			marker.getElement().setAttribute("aria-label", `Navigate to ${place.label}: ${place.name}`);
			return marker;
		});
		return () => markers.forEach(marker => marker.remove());
	}, [mapLoaded, savedPlaces, favourites]);
	// The globe's clouds follow the setting (and are applied again whenever the style reloads, in useMapbox).
	useEffect(() => { const map = mapRef.current; if (map && mapLoaded) setCloudsVisible(map, showClouds); }, [showClouds, mapLoaded]);
	// The globe's night side follows its setting too, and the lighting preset goes with it (the globe is lit as day only while the night side is drawn).
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !mapLoaded) return;
		void applyNight(map, showNight, new Date(), lightsUrl);
		setLightPreset(map, presetFor(period, map.getZoom(), period, showNight));
	}, [showNight, mapLoaded]); // eslint-disable-line
	useDestinationHighlight(mapRef, mapLoaded, selectingBuilding ?? pendingDest?.buildingCoords ?? (navActive || arrivedAt ? navBuildingRef.current : null));
	const {
		coordsRef,
		maneuversRef,
		maneuvers,
		applyRoute,
		refreshTimings,
		drawRoute,
		drawAlternatives,
		clearRoute,
		trimRouteByDistance,
		drawnCoords,
	} = useRoute(mapRef);
	fogRouteRef.current = drawnCoords;

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
	// Centres the map (the globe when zoomed out, the car when driving) in the space the bars and docks leave free.
	const paddingHold = useRef(false);
	const cameraPadding = useCameraPadding(mapRef, mapLoaded, cameraMode, paddingHold);

	// ── Puck — render loop drives both model and camera ────────────────────────
	// smoothLocate is destructured here alongside updatePuck and resetCursor.
	const lookAheadRef = useRef<{ enabled: boolean; distanceToNextM: number | null; significantTurn?: boolean }>({ enabled: false, distanceToNextM: null });
	const { updatePuck, resetCursor, smoothLocate, syncPuck, puckPosition } = usePositionPuck(
		mapRef,
		mapLoaded,
		DEV_ORIGIN,
		coordsRef,
		followingRef,
		orientationRef,
		cameraTransitionRef,
		trimRouteByDistance,
		mapOffset,
		lookAheadRef,
		puckFogRef,
		pacmanOnRef,
	);
	fogPuckRef.current = puckPosition;

	useMapStyle(mapRef, mapLoaded, period, weather, weatherAppearance, () => {
		syncPuck(lastPosRef.current, lastBearingRef.current, lastSpeedRef.current);
	}, gameMode === "pacman");

	// A stop the car has reached is done: a reroute afterwards must not send it back to it.
	const dropReachedStop = useCallback((pos: [number, number]) => {
		const [next, ...rest] = navStopsRef.current;
		if (next && distanceKm(pos, next) < 0.06) navStopsRef.current = rest;
	}, []);

	// ── Reroute ────────────────────────────────────────────────────────────────
	const handleOffRoute = useCallback(async () => {
		if (!navDestRef.current || isRerouting) return;
		const request = ++routeRequest.current;
		setIsRerouting(true);
		try {
			const route = await getRoute(
				lastPosRef.current,
				navDestRef.current,
				provider,
				navStopsRef.current,
				navBuildingRef.current ?? undefined,
				// Heading only when moving: a receiver's heading at a standstill is the last one it had, which may be stale.
				{ avoid: routePreferences, speedMs: lastSpeedRef.current, headingDeg: lastSpeedRef.current > 2 ? lastBearingRef.current : undefined },
			);
			if (request !== routeRequest.current || !navDestRef.current) return;
			if (route.coords.length < 2 || !route.maneuvers.length)
				throw new Error("No drivable route was found.");
			applyRoute(route);
			setActiveRoute(route);
			simIndexRef.current = 0;
			resetNavigation();
			resetCursor();
			updatePuck(lastPosRef.current, lastBearingRef.current, lastSpeedRef.current);
			resumeFollowing();
		} catch {
			if (request === routeRequest.current)
				setRouteError("Could not update the route. Keeping your current route.");
		} finally {
			setIsRerouting(false);
		}
	}, [applyRoute, isRerouting, provider, routePreferences]);

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
	lookAheadRef.current = { enabled: navActive, distanceToNextM: navActive ? distanceToNextM : null, significantTurn: isSignificantTurn(maneuvers[currentStep + 1]) };

	// ── Position update ────────────────────────────────────────────────────────
	const trackedPositionUpdate = useCallback(
		async (
			pos: [number, number],
			bearing: number,
			speed: number,
			prov: RoutingProvider,
			trusted = false,
		) => {
			lastPosRef.current = pos;
			updatePosition(pos);
			lastBearingRef.current = bearing;
			lastSpeedRef.current = speed;
			setVehicleSpeedMs(speed);
			setDrivingState((previous) => nextDrivingState(previous, speed));
			const routeEnd = coordsRef.current[coordsRef.current.length - 1];
			if (coordsRef.current.length) setRoutePosition(closestRouteIndex(pos, coordsRef.current));
			setNearRouteEnd(!!routeEnd && distanceKm(pos, routeEnd) < 0.03);
			updatePuck(pos, bearing, speed);
			if (navActive) dropReachedStop(pos);
			await onPositionUpdate(pos, bearing, speed, prov, trusted);
		},
		[updatePuck, onPositionUpdate, updatePosition, closestRouteIndex, navActive, dropReachedStop],
	);

	// ── GPS ────────────────────────────────────────────────────────────────────
	const { status: gpsStatus } = useGps(
		useCallback(
			(pos: [number, number], bearing: number, speed: number) => {
				lastFixRef.current = { pos, time: Date.now(), speed };
				lastPosRef.current = pos;
				// Real fixes explore (so do simulated drives, recorded where the simulation reports; never dead reckoning).
				recordExploreFix(pos, speed, bearing);
				updatePosition(pos);
				lastBearingRef.current = bearing;
				lastSpeedRef.current = speed;
				setVehicleSpeedMs(speed);
				setDrivingState((previous) => nextDrivingState(previous, speed));

				updatePuck(pos, bearing, speed);
				if (navActive) dropReachedStop(pos);

				if (navActive && !isRerouting) {
					if (coordsRef.current.length > 0) {
						const idx = closestRouteIndex(pos, coordsRef.current);
						simIndexRef.current = idx;
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
				recordExploreFix,
			],
		),
	);

	// ── Simulation ─────────────────────────────────────────────────────────────
	const isDriving = interactionLocked(
		previewMode,
		gpsStatus === "fix",
		drivingState,
	);
	// Keep moving along the route through tunnels and other GPS dropouts.
	const estimating = useDeadReckoning(
		navActive && !isRerouting && !pendingDest,
		coordsRef,
		lastFixRef,
		useCallback((pos: [number, number], bearing: number, speed: number) => { void trackedPositionUpdate(pos, bearing, speed, provider, true); }, [trackedPositionUpdate, provider]),
	);
	useEffect(() => {
		if (!navActive || !activeRoute || provider !== "mapbox" || !navDestRef.current || pendingDest) return;
		let cancelled = false;
		const timer = window.setInterval(async () => {
			try {
				const routes = await getRoutes(activeRoute.coords[0], navDestRef.current!, provider, navStopsRef.current, navBuildingRef.current ?? undefined, { avoid: routePreferences });
				const match = routes.find(route => route.coords.length === activeRoute.coords.length && route.coords.every((coord, index) => coord[0] === activeRoute.coords[index][0] && coord[1] === activeRoute.coords[index][1]));
				if (cancelled) return;
				// A different road for the same trip is not a failure: the service answered, it just chose another way.
				if (!match) return;
				if (!refreshTimings(match)) { trafficMisses.current++; if (trafficMisses.current >= 2) setTrafficStale(true); return; }
				trafficMisses.current = 0;
				setTrafficStale(false);
				setActiveRoute({ ...match, coords: activeRoute.coords });
				drawRoute(activeRoute.coords, match.congestion);
			} catch { if (!cancelled) { trafficMisses.current++; if (trafficMisses.current >= 2) setTrafficStale(true); } }
		}, 120000);
		return () => { cancelled = true; window.clearInterval(timer); };
	}, [navActive, activeRoute, provider, pendingDest, routePreferences]);
	// The manoeuvre ahead and the ones after it, with what the voice needs to word them well.
	const guidanceSteps = useMemo<GuidanceStep[]>(() => maneuvers.slice(currentStep + 1, currentStep + 8).map((step, offset) => ({
		id: step.begin_shape_index,
		instruction: step.instruction,
		type: step.type,
		modifier: step.modifier,
		lengthM: (step.length ?? 0) * 1000,
		lanes: step.lanes,
		final: currentStep + 1 + offset === maneuvers.length - 1,
	})), [maneuvers, currentStep]);
	const guidance = useSpokenNavigation(guidanceSteps, distanceToNextM, navActive, vehicleSpeedMs);
	// Spoken notices about the road ahead, each said once: a rerouting, then closures and incidents as they come within range.
	const announcedAlerts = useRef(new Set<string>());
	useEffect(() => { if (isRerouting) guidance.announce("Rerouting."); }, [isRerouting]); // eslint-disable-line
	useEffect(() => {
		if (!navActive) { announcedAlerts.current.clear(); return; }
		const alert = routeAlerts.find(item => (item.kind === "closure" || item.kind === "incident" || item.kind === "camera" || item.kind === "hazard") && !announcedAlerts.current.has(item.id) && (item.aheadM ?? 0) <= (item.kind === "camera" || item.kind === "hazard" ? Math.min(HAZARD_ALERT_M, 800) : 3000));
		if (!alert) return;
		announcedAlerts.current.add(alert.id);
		guidance.announce(alert.kind === "closure" ? "There is a road closure on your route." : alert.kind === "camera" || alert.kind === "hazard" ? `${alert.title} ahead.` : "There is a traffic incident ahead.");
	}, [routeAlerts, navActive]); // eslint-disable-line
	// Developer aid: braveSay("Turn left onto Papanui Rd") in the console speaks it the way guidance would.
	useEffect(() => { (window as unknown as { braveSay?: (text: string) => void }).braveSay = guidance.sample; }, [guidance.sample]);
	const voiceStatus =
		guidance.engine === "system"
			? "system voice (chosen in Settings)"
			: kokoroStatus === "ready"
				? kokoroVoice.device === "webgpu" ? "natural voice ready (GPU)" : "natural voice ready (CPU, slower: phrases are prepared ahead)"
				: kokoroStatus === "failed"
					? `system voice — natural voice failed: ${kokoroVoice.error ?? "unknown error"}`
					: "system voice until the natural voice has loaded (first use downloads the model)";
	// ── Faster-route suggestions ───────────────────────────────────────────────
	// Every 90 s, ask for routes from where you are now; offer one only if it is a
	// different road that saves real time. Trips with added stops are skipped.
	const [fasterOffer, setFasterOffer] = useState<FasterRoute | null>(null);
	const dismissedFaster = useRef(new Set<string>());
	const announcedFaster = useRef<string | null>(null);
	const fasterCheck = useRef({ maneuvers, currentStep, timeToNextS, distanceToNextM, announce: guidance.announce, routePosition });
	fasterCheck.current = { maneuvers, currentStep, timeToNextS, distanceToNextM, announce: guidance.announce, routePosition };
	useEffect(() => {
		if (!navActive) { setFasterOffer(null); dismissedFaster.current.clear(); announcedFaster.current = null; }
	}, [navActive]);
	useEffect(() => {
		if (!navActive || provider !== "mapbox" || pendingDest || isRerouting) return;
		let cancelled = false;
		const check = async () => {
			const destination = navDestRef.current;
			if (!destination || navStopsRef.current.length || !coordsRef.current.length) return;
			try {
				const routes = await getRoutes(lastPosRef.current, destination, provider, [], navBuildingRef.current ?? undefined, { avoid: routePreferences, speedMs: lastSpeedRef.current });
				if (cancelled) return;
				const now = fasterCheck.current;
				const remaining = remainingSeconds(now.maneuvers, now.currentStep, now.timeToNextS);
				const offer = findFasterRoute(remaining, coordsRef.current.slice(Math.max(0, now.routePosition - 1)), routes);
				if (!offer || dismissedFaster.current.has(offer.key)) { setFasterOffer(null); return; }
				setFasterOffer(offer);
				if (announcedFaster.current !== offer.key && (now.distanceToNextM ?? Infinity) > 300) {
					announcedFaster.current = offer.key;
					now.announce(`A faster route is available. It is ${describeSaving(offer.savedSeconds)}.`);
				}
			} catch { /* Keep the current route; try again at the next check. */ }
		};
		const timer = window.setInterval(check, 90000);
		return () => { cancelled = true; window.clearInterval(timer); };
	}, [navActive, provider, pendingDest, isRerouting, routePreferences]);
	function handleSwitchFaster() {
		if (!fasterOffer) return;
		const { route } = fasterOffer;
		dismissedFaster.current.add(fasterOffer.key);
		setFasterOffer(null);
		applyRoute(route);
		setActiveRoute(route);
		setRoutePosition(0);
		simIndexRef.current = 0;
		resetNavigation();
		resetCursor();
		updatePuck(lastPosRef.current, lastBearingRef.current, lastSpeedRef.current);
		resumeFollowing();
	}
	// A quick-stop icon opens the Add stop panel already filtered; tapping the active one closes it again.
	function handleQuickStop(category: string | null) {
		if (!category) { setStopCategory(null); setOpenPanel(null); return; }
		setNavToolsOpen(true);
		setStopCategory(category);
		setOpenPanel("search");
	}
	function handleKeepRoute() {
		if (fasterOffer) dismissedFaster.current.add(fasterOffer.key);
		setFasterOffer(null);
	}
	// Simulated drives explore too (the dead-reckoning guesses during GPS gaps do not: they go straight to trackedPositionUpdate).
	const simulatedPositionUpdate = useCallback(
		(pos: [number, number], bearing: number, speed: number, prov: RoutingProvider, trusted?: boolean) => {
			recordExploreFix(pos, speed, bearing);
			return trackedPositionUpdate(pos, bearing, speed, prov, trusted);
		},
		[recordExploreFix, trackedPositionUpdate],
	);
	const { startSimulation, stopSimulation } = useSimulation(
		coordsRef,
		activeRouteRef,
		simulatedPositionUpdate,
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
		async (coords: [number, number], placeName: string, buildingCoords = coords, details?: PlaceDetails) => {
			// A passenger can search and choose a destination while the car is moving.
			const request = ++routeRequest.current;
			setSelectingBuilding(buildingCoords);
			setRouteBusy(true);
			setRouteError(null);
			try {
				const stops = navActive ? [...navStopsRef.current, coords] : [];
				const destination =
					navActive && navDestRef.current ? navDestRef.current : coords;
				const routes = await getRoutes(
					lastPosRef.current,
					destination,
					provider,
					stops,
					navActive ? navBuildingRef.current ?? undefined : buildingCoords,
					{ avoid: routePreferences },
				);
				const route = routes[0];
				if (request !== routeRequest.current) return;
				if (!route.maneuvers.length)
					throw new Error("No drivable route was found.");
				drawRoute(route.coords, route.congestion);
				const summary = summarizeManeuvers(route.maneuvers);
				setPendingDest({
					coords,
					buildingCoords,
					placeName,
					details,
					...summary,
					action: navActive ? "stop" : "destination",
					route,
					routes,
					stops,
				});
			} finally {
				if (request === routeRequest.current) { setRouteBusy(false); setSelectingBuilding(null); }
			}
		},
		[isDriving, navActive, provider, drawRoute, showOverview, routePreferences],
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
				const poi = map.queryRenderedFeatures([[point.x - 18, point.y - 18], [point.x + 18, point.y + 18]], { target: { featuresetId: "poi", importId: "basemap" } }).find(feature => typeof feature.properties?.name === "string" && feature.geometry.type === "Point");
				const selected = poi && poi.geometry.type === "Point" ? { coords: poi.geometry.coordinates as [number, number], placeName: String(poi.properties.name) } : destinationFromFeatures(features, coords);
				const lookup = await reverseGeocodeDestination(selected?.coords ?? coords, selected?.placeName);
				const samePlace = !selected || sameBusinessName(lookup.placeName, selected.placeName);
				const destination = selected ? { ...selected, placeName: samePlace ? lookup.placeName : selected.placeName } : lookup;
				await handleSearchSelect(destination.coords, destination.placeName, coords, samePlace ? lookup.details : undefined);
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
		// Touches on or near the controls, or in the gaps between them, are not meant for the map.
		const onUsableMap = (point: mapboxgl.Point) => {
			const container = map.getContainer();
			const bounds = container.getBoundingClientRect();
			return isUsableMapPoint(bounds.left + point.x, bounds.top + point.y, container);
		};
		const handleMapClick = (event: mapboxgl.MapMouseEvent) => {
			// Only the primary button picks a place; right and middle clicks do nothing.
			if (event.originalEvent.button !== 0) return;
			// With a menu open, a tap on the map just closes it and carries on; it never picks a place.
			if (menuRef.current.open) { menuRef.current.close(); return; }
			if (isDriving || Date.now() < ignoreClickUntil) return;
			if (!onUsableMap(event.point)) return;
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
			if (!("points" in event) && event.originalEvent.button !== 0) return;
			if (menuRef.current.open) return;
			if (isDriving && !navActive) return;
			const { lngLat, point } = event;
			if (!onUsableMap(point)) return;
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
	const previewCoords = pendingDest ? pendingDest.routes : null;
	useEffect(() => {
		const routes = pendingDest ? pendingDest.routes.filter(route => route !== pendingDest.route).map(route => route.coords) : [];
		drawAlternatives(routes);
		return () => drawAlternatives([]);
	}, [pendingDest, mapLoaded]);
	useEffect(() => {
		if (!previewCoords) return;
		const frame = requestAnimationFrame(() => showOverview(previewCoords.flatMap(route => route.coords)));
		return () => cancelAnimationFrame(frame);
	}, [previewCoords]);

	// ── Saved and frequent destinations ────────────────────────────────────────
	useEffect(() => {
		if (openPanel !== "search") setPlaceSlot(null);
	}, [openPanel]);
	function handleQuickDestination(coords: [number, number], placeName: string, buildingCoords?: [number, number]) {
		setOpenPanel(null);
		handleSearchSelect(coords, placeName, buildingCoords).catch((cause) =>
			setRouteError(
				cause instanceof Error ? cause.message : "Could not calculate route.",
			),
		);
	}
	function handleSetPlace(slot: PlaceTarget) {
		setPlaceSlot(slot);
		setOpenPanel("search");
	}

	async function handleConfirmNav() {
		if (!pendingDest) return;
		recordFrequentPlace(pendingDest.placeName, pendingDest.coords, pendingDest.buildingCoords);
		stopSimulation();
		applyRoute(pendingDest.route);
		setActiveRoute(pendingDest.route);
		setRoutePosition(0);
		if (pendingDest.action === "destination") {
			navDestRef.current = pendingDest.coords;
			navBuildingRef.current = pendingDest.buildingCoords;
			navDestNameRef.current = pendingDest.placeName;
		}
		setArrivedAt(null);
		setTrafficStale(false);
		trafficMisses.current = 0;
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
		setSelectingBuilding(null);
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
		setSelectingBuilding(null);
		setActiveRoute(null);
		routeRequest.current++;
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
		setTrafficStale(false);
		trafficMisses.current = 0;
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
		guidance.finish(`You have arrived${name ? ` at ${name.split(",")[0]}` : ""}.`);
		handleEndNavigation();
		setArrivedAt(name ?? "your destination");
	}, [currentStep, distanceToNextM, nearRouteEnd, maneuvers.length, navActive, handleEndNavigation]);
	useEffect(() => {
		if (!arrivedAt) return;
		const timer = window.setTimeout(() => setArrivedAt(null), 20000);
		return () => window.clearTimeout(timer);
	}, [arrivedAt]);

	// The heading-up / north-up button. Out at the globe it first brings the camera down to the car (turning the view there would snap
	// the camera to the car at once), and during the flight it waits.
	function handleViewButton() {
		if (showcase.approachIfAway(true) || showcase.cameraAway()) return;
		toggleOrientation(lastBearingRef.current, lastPosRef.current, smoothLocate);
	}

	function handleLocate() {
		// On the globe, the locate button brings the camera down to the car.
		if (showcase.approachIfAway(true)) return;
		resumeFollowing();
		smoothLocate();
	}

	// The turning globe at start and when idle; down to the car when destinations are used or the car moves.
	const showcase = useGlobeShowcase({
		mapRef, mapLoaded,
		enabled: globeIdle,
		hasPosition: previewMode || gpsStatus === "fix",
		positionRef: lastPosRef, bearingRef: lastBearingRef, mapOffset, cameraTransitionRef,
		paddingHold, paddingAt: cameraPadding.paddingAt, refreshPadding: cameraPadding.refresh, blendToCar: smoothLocate,
		wantsLocal: wantsLocation({ driving: isDriving, navigating: navActive, destinationPending: !!pendingDest, searchOpen: openPanel === "search", routing: routeBusy, choosingBuilding: !!selectingBuilding }),
		parked: !isDriving && !navActive && !pendingDest && !arrivedAt && openPanel === null && !routeBusy && !selectingBuilding && !dockEditing && !profilesOpen,
	});

	// The camera comes back to following (the automatic return after browsing, say) while it is out at the globe: fly down to the car.
	const previousCameraMode = useRef(cameraMode);
	useEffect(() => {
		const was = previousCameraMode.current;
		previousCameraMode.current = cameraMode;
		if (cameraMode === "following" && was !== "following") showcase.approachIfAway(true);
	}, [cameraMode]);

	// ── Speed signs ────────────────────────────────────────────────────────────
	// Show your speed whenever the position is real or being estimated along the route, and the
	// posted limit only while you are on the route (a wrong limit is worse than none).
	const showSpeed = gpsStatus === "fix" || estimating || (previewMode && navActive);
	// Judged against the road itself, not the nearest vertex: vertices can be a hundred metres apart on a straight.
	const onRouteNow = navActive && showSpeed && !!activeRoute && activeRoute.coords.length > 1 && locateOnRoute(activeRoute.coords, routeDistances(activeRoute.coords), lastPosRef.current, routeHintRef.current).offsetM < 30;
	const signState = speedSignState(vehicleSpeedMs, limitAt(activeRoute?.speedLimits, routePosition, onRouteNow));
	// The smooth-driving score counts time over the posted limit, where the route says what it is.
	driveLimitRef.current = () => signState.limit?.kind === "limit" ? signState.limit.speed / (signState.limit.unit === "mph" ? 2.23694 : 3.6) : null;

	// One banner at a time, most urgent first. A closure on the route always shows; otherwise nothing
	// competes with a turn that is close, and a faster-route offer waits until the road is clear.
	const bannerRoom = navActive && !pendingDest && openPanel !== "search";
	const turnClose = distanceToNextM != null && distanceToNextM <= 300;
	const urgentAlert = routeAlerts.some(alert => alert.severity === "error");
	const showFasterOffer = bannerRoom && !!fasterOffer && !turnClose && !urgentAlert;
	const showAlertBanner = bannerRoom && routeAlerts.length > 0 && (urgentAlert || !turnClose) && !showFasterOffer;

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
						pt: "16px", pb: "16px", pl: `${insetLeft}px`, pr: `${insetRight}px`,
						pointerEvents: "none",
						"& > *": { pointerEvents: "auto" },
						zIndex: 10,
						display: "grid",
						gap: 2,
					}}
				>
					{!clearView && <Box
						// Pulls the status bar out to the screen edges, past the overlay's own padding.
						sx={{ m: `-16px -${insetRight}px 0 -${insetLeft}px` }}
					>
						<ClockWeatherChip
							position={lastPosRef.current}
							gpsStatus={gpsStatus}
							estimating={estimating}
							previewMode={previewMode}
							onProfile={() => setProfilesOpen(true)}
							onPhone={() => setPhoneOpen((open) => !open)}
						/>
						<PhoneNotifications open={phoneOpen} onOpen={() => setPhoneOpen(true)} onClose={() => setPhoneOpen(false)} quiet={navActive && isDriving} onRead={guidance.readAloud} />
						<ProfileDialog open={profilesOpen} onClose={() => setProfilesOpen(false)} lockSwitch={navActive || isDriving} lockEdit={isDriving} />
					</Box>}
					{/* Floats over the map just below the top bar, so nothing else moves when a discovery is announced. */}
					<Box sx={{ position: "absolute", top: "100%", left: insetLeft, right: insetRight, pointerEvents: "none" }}>
						<DiscoveryNotices notices={[...explore.notices, ...pacman.notices, ...drives.notices]} onDismiss={(key) => { explore.dismissNotice(key); pacman.dismissNotice(key); drives.dismissNotice(key); }} />
						{/* The smooth-driving score is always on (unless switched off in Settings → Trips); the game modes add theirs below it. */}
						<Box sx={{ position: "absolute", top: 0, left: 0, mt: 1, display: "grid", gap: 1, justifyItems: "start", pointerEvents: "none" }}>
							{smoothHud && <DriveHud mode="smooth" live={drives.live} race={null} flash={drives.flash} />}
							{gameMode === "pacman" && <PacmanHud stats={pacman.stats} />}
							{gameMode === "ghost" && <DriveHud mode="ghost" live={drives.live} race={drives.race} flash={drives.flash} />}
						</Box>
					</Box>
					{navActive && (
						<NavigationCard
							maneuvers={maneuvers}
							currentStep={currentStep}
							distanceToNextM={distanceToNextM}
							timeToNextS={timeToNextS}
							isDriving={isDriving}
							onRepeat={guidance.speak}
							listContainer={turnsSlot}
						/>
					)}
					<Box ref={setTurnsSlot} sx={{ display: "contents" }} />
					{!clearView && <Box component="nav" id="navigation-options" aria-label="Map controls" sx={{ display: navActive && !navToolsOpen ? "none" : "flex", alignItems: "center", gap: 1, position: "relative", zIndex: 20, order: navActive ? 1 : 0, "& .map-action": { minWidth: "var(--map-target)", minHeight: 96, bgcolor: (theme: Theme) => alpha(theme.palette.background.paper, 0.92), backdropFilter: "blur(12px)", border: "1px solid", borderColor: "divider", boxShadow: 6, borderRadius: 3, "&:hover": { bgcolor: (theme: Theme) => alpha(theme.palette.background.paper, 0.92) } }, "--map-target": "clamp(76px, 8vw, 88px)", }}>
				<MapControls
						gpsStatus={gpsStatus}
					gamesPanel={<GameModesPanel mode={gameMode} onModeChange={setGameMode} panels={{ fog: <ExplorePanel stats={explore.stats} home={savedPlaces.home?.coords} shareAround={explore.shareAround} onReset={explore.reset} isDriving={isDriving} />, pacman: <PacmanPanel stats={pacman.stats} regrow={pacmanRegrow} onRegrowChange={setPacmanRegrow} ghosts={pacmanGhosts} onGhostsChange={setPacmanGhosts} sound={pacmanSound} onSoundChange={setPacmanSound} onReset={pacman.reset} isDriving={isDriving} playing={gameMode === "pacman"} />, ghost: <GhostPanel trips={drives.trips} playing={gameMode === "ghost"} /> }} />}
					tripsPanel={<TripsPanel trips={drives.trips} loaded={drives.loaded} onReset={drives.reset} isDriving={isDriving} showScore={smoothHud} onShowScoreChange={setSmoothHud} />}
					route={navActive ? coordsRef.current.slice(Math.max(0, routePosition - 1)) : undefined}
					routePreferences={routePreferences}
					stopCategory={stopCategory}
					onStopCategoryChange={setStopCategory}
					showTraffic={showTraffic}
					onShowTrafficChange={setShowTraffic}
					onRoutePreferencesChange={setRoutePreferences}
                    panel={openPanel === "search" || openPanel === "settings" ? openPanel : null}
                    setPanel={setOpenPanel}
					cameraMode={cameraMode}
					orientation={orientation}
					hasRoute={maneuvers.length > 0}
					currentBearing={mapBearing}
					currentPosition={lastPosRef.current}
					mapboxToken={process.env.MAPBOX_TOKEN}
					onOverview={() => showOverview(coordsRef.current)}
					onToggleOrientation={handleViewButton}
					onSearchSelect={
						placeSlot
							? async (coords, placeName, buildingCoords) => {
									if (placeSlot === "favourite") setFavourites(addFavourite(placeName, coords, buildingCoords));
									else setSavedPlaces(savePlace(placeSlot, placeName, coords, buildingCoords));
									setOpenPanel("settings");
								}
							: handleSearchSelect
					}
					searchTitle={placeSlot ? (placeSlot === "home" ? "Set Home address" : placeSlot === "work" ? "Set Work address" : "Add a favourite") : undefined}
					onSetPlace={navActive ? undefined : handleSetPlace}
					savedPlaces={savedPlaces}
					favourites={favourites}
					onPlaceMarker={target => {
						if (typeof target === "string") setSavedPlaces(setPlaceMarker(target, nextMarker(savedPlaces[target]?.marker ?? defaultMarker(target))));
						else setFavourites(setFavouriteMarker(target.favourite, nextMarker(favourites.find(item => item.id === target.favourite)?.marker)));
					}}
					onRemoveFavourite={id => setFavourites(removeFavourite(id))}
					onGoToPlace={navActive ? undefined : handleQuickDestination}
					hazardAlerts={hazardAlerts}
					onCustomiseDock={() => setDockEditing(true)}
					showClouds={showClouds}
					showNight={showNight}
					globeIdle={globeIdle}
					onGlobeIdleChange={setGlobeIdle}
					onShowNightChange={setShowNight}
					onShowCloudsChange={setShowClouds}
					dockSide={dockSide}
					onDockSideChange={setDockSide}
					onHazardAlertsChange={setHazardAlerts}
					voiceStatus={voiceStatus}
					voiceEngine={guidance.engine}
					onVoiceEngineChange={guidance.setEngine}
					onTestVoice={guidance.test}
					onTestAlert={guidance.testAlert}
					onTestMessage={guidance.testMessage}
					onCancelRouting={() => {
						routeRequest.current++;
						setSelectingBuilding(null);
						setRouteBusy(false);
					}}
					onLocate={handleLocate}
					isNavActive={navActive}
					provider={provider}
					onToggleProvider={handleToggleProvider}
					isDriving={isDriving}
					quickPlaces={!pendingDest && !arrivedAt && <QuickDestinations saved={savedPlaces} onGo={handleQuickDestination} onSet={handleSetPlace} disabled={routeBusy} />}
					quickStops={navActive ? <QuickStops selected={openPanel === "search" ? stopCategory : null} onSelect={handleQuickStop} /> : undefined}
					extraActions={<DriveButton className="map-action" color="inherit" aria-label="Clear view: hide the controls" onClick={enterClearView}><VisibilityOffRounded /></DriveButton>}
				/>
					</Box>}

					{(routeBusy || isRerouting) && (
						<Alert severity="info" sx={{ fontSize: 28, order: 2 }}>
							Calculating route...
						</Alert>
					)}
					{showFasterOffer && fasterOffer && <Box sx={{ order: 2 }}><FasterRouteOffer savedSeconds={fasterOffer.savedSeconds} arrival={new Date(Date.now() + routeSeconds(fasterOffer.route) * 1000).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" })} onSwitch={handleSwitchFaster} onKeep={handleKeepRoute} disabled={isRerouting} /></Box>}
					{showAlertBanner && <Box sx={{ order: 2 }}><RouteAlerts alerts={routeAlerts.slice(0, 1)} /></Box>}
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
							position={pendingDest.buildingCoords}
							placeName={pendingDest.placeName}
							details={pendingDest.details}
							isDriving={isDriving}
							choices={pendingDest.routes.map(r => summarizeManeuvers(r.maneuvers))}
							selected={pendingDest.routes.indexOf(pendingDest.route)}
							onChoose={(index) => {
								const route = pendingDest.routes[index];
								if (!route || isDriving) return;
								setPendingDest({ ...pendingDest, route, ...summarizeManeuvers(route.maneuvers) });
								drawRoute(route.coords, route.congestion);
							}}
							detour={pendingDest.action === "stop" ? detourLabel(pendingDest.route.maneuvers, maneuvers.slice(currentStep)) : undefined}
							etaSeconds={secondsToPlace(pendingDest.route, pendingDest.action, pendingDest.stops.length)}
							duration={pendingDest.duration}
							distance={pendingDest.distance}
							confirmLabel={
								pendingDest.action === "stop" ? "Add stop" : "Go"
							}
							onConfirm={handleConfirmNav}
							onCancel={handleCancelSearch}
							disabled={false}
						/>
					) : navActive ? (
						<Box sx={{ display: "grid", gap: 1 }}>
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
							onToggleOrientation={handleViewButton}
						/>
						</Box>
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
			<CarControls clear={clearView} overlay={showSpeed ? <SpeedSigns state={signState} estimated={estimating} simulated={gpsStatus !== "fix" && !estimating} /> : undefined} isDriving={isDriving} panel={openPanel === "media" ? "media" : null} setPanel={setOpenPanel} editing={dockEditing} onEditingChange={setDockEditing} side={dockSide} />
			{/* Clear view hides everything else, so the way back is always here: a quiet button in the corner. */}
			{clearView && <DriveButton color="inherit" aria-label="Show the controls" onClick={() => setClearView(false)} sx={{ position: "absolute", left: 24, bottom: 24, zIndex: 30, minWidth: 0, width: 72, height: 72, borderRadius: "50%", opacity: 0.6, bgcolor: (theme: Theme) => alpha(theme.palette.background.paper, 0.85), backdropFilter: "blur(12px)", border: "1px solid", borderColor: "divider", boxShadow: 6, "&:hover, &:focus-visible": { opacity: 1, bgcolor: (theme: Theme) => alpha(theme.palette.background.paper, 0.95) } }}><VisibilityRounded sx={{ fontSize: 36 }} /></DriveButton>}
		</Box>
	);
}
