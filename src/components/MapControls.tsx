import { ipcRenderer } from "electron";
import React, { useEffect, useState } from "react";
import {
	Box,
	Typography,
} from "@mui/material";
import type { CameraMode, Orientation, RoutingProvider } from "../constants";
import CloseRounded from "@mui/icons-material/CloseRounded";
import ExploreRounded from "@mui/icons-material/ExploreRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import MyLocationRounded from "@mui/icons-material/MyLocationRounded";
import RouteRounded from "@mui/icons-material/RouteRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import SettingsRounded from "@mui/icons-material/SettingsRounded";
import { useThemeMode } from "../ThemeContext";
import { THEME_PREFERENCES } from "../lib/ambientTheme";
import VolumeUpRounded from "@mui/icons-material/VolumeUpRounded";
import VolumeDownRounded from "@mui/icons-material/VolumeDownRounded";
import { useKeyboard } from "../contexts/KeyboardContext";
import DriveButton from "./DriveButton";
import DestinationSearch, { topSheetSx } from "./DestinationSearch";
import type { PlaceSlot } from "../lib/savedPlaces";
import type { RoutePreference } from "../lib/routing";
import type { PlaceDetails } from "../lib/locationSearch";
interface Props {
	panel: "search" | "settings" | null;
	setPanel: (panel: "search" | "settings" | null) => void;
	cameraMode: CameraMode;
	orientation: Orientation;
	hasRoute: boolean;
	currentBearing: number;
	currentPosition: [number, number];
	mapboxToken: string;
	onOverview: () => void;
	onToggleOrientation: () => void;
	onSearchSelect: (
		coords: [number, number],
		placeName: string,
		buildingCoords?: [number, number],
		details?: PlaceDetails,
	) => Promise<void>;
	onCancelRouting: () => void;
	isNavActive: boolean;
	onLocate: () => void;
	provider: RoutingProvider;
	onToggleProvider: () => void;
	isDriving: boolean;
	/** Extra buttons shown with the map utilities (navigation only). */
	extraActions?: React.ReactNode;
	/** Heading for the search panel when it is choosing a saved place. */
	searchTitle?: string;
	/** Opens search to choose the Home or Work address. */
	onSetPlace?: (slot: PlaceSlot) => void;
	/** One-line description of which guidance voice is in use. */
	voiceStatus?: string;
	voiceEngine?: "natural" | "system";
	onVoiceEngineChange?: (engine: "natural" | "system") => void;
	voiceVolume?: number;
	onVoiceVolumeChange?: (volume: number) => void;
	onTestVoice?: () => void;
	routePreferences?: RoutePreference[];
	showTraffic?: boolean;
	/** Stop category chosen with the quick-stop icons. */
	stopCategory?: string | null;
	onStopCategoryChange?: (category: string | null) => void;
	onShowTrafficChange?: (value: boolean) => void;
	onRoutePreferencesChange?: (values: RoutePreference[]) => void;
	route?: [number, number][];
}
export default function MapControls({
	panel, setPanel,
	cameraMode,
	orientation,
	hasRoute,
	currentPosition,
	mapboxToken,
	onOverview,
	onToggleOrientation,
	onSearchSelect,
	onCancelRouting,
	isNavActive,
	onLocate,
	provider,
	onToggleProvider,
	isDriving,
	extraActions,
	searchTitle,
	onSetPlace,
	voiceStatus,
	voiceEngine = "natural", onVoiceEngineChange,
	voiceVolume = 1, onVoiceVolumeChange, onTestVoice,
	routePreferences = [], onRoutePreferencesChange,
	showTraffic = true, onShowTrafficChange,
	stopCategory, onStopCategoryChange,
	route,
}: Props) {
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const { hideKeyboard } = useKeyboard();
	const { preference, setPreference, reason, weatherAppearance, setWeatherAppearance } = useThemeMode();

	function close() {
		setPanel(null);
		hideKeyboard();
	}
	useEffect(() => {
		// A stop can still be added while moving, so that panel stays open.
		if (isDriving && !(isNavActive && panel === "search")) {
			setPanel(null);
			hideKeyboard();
		}
	}, [isDriving, hideKeyboard]);
	return (
		<>
			<Box sx={{ display: "contents" }}>
				{/* Map utilities sit on the far side; the primary action (Destination)
				    sits on the driver's side, in line with Start and End. */}
				<Box sx={{ display: "flex", gap: 1, color: "text.primary" }}>
				<DriveButton className="map-action" color="inherit"
					disabled={isDriving}
					aria-label="Open settings"
					aria-expanded={panel === "settings"}
					variant={panel === "settings" ? "contained" : "text"}
					onClick={() => (panel === "settings" ? close() : setPanel("settings"))}
				>
					<SettingsRounded />
				</DriveButton>
				{!isNavActive && <DriveButton className="map-action" color="inherit"
					aria-label={
						orientation === "heading"
							? "Switch to north up"
							: "Switch to heading up"
					}
					onClick={onToggleOrientation}
				>
					<ExploreRounded />
				</DriveButton>}
				{hasRoute && (
					<DriveButton className="map-action" color="inherit" aria-label="Route overview" onClick={onOverview}>
						<RouteRounded />
					</DriveButton>
				)}
				{!isNavActive && <DriveButton className="map-action" color="inherit" aria-label="Centre on location" disabled={cameraMode === "following"} onClick={onLocate}>
					<MyLocationRounded />
				</DriveButton>}
				{extraActions}
				</Box>
				<DriveButton className="map-action"
					disabled={isDriving && !isNavActive}
					aria-label={isNavActive ? "Add a stop" : "Choose destination"}
					aria-expanded={panel === "search"}
					onClick={() => (panel === "search" ? close() : setPanel("search"))}
					sx={{ flex: "0 1 400px", minWidth: 200, justifyContent: "flex-start", px: 3, ml: "auto" }}
				>
					<SearchRounded />
					<Box component="span" sx={{ ml: 1 }}>
						{isNavActive ? "Add stop" : "Destination"}
					</Box>
				</DriveButton>
			</Box>
			{panel === "search" && (
				<DestinationSearch
					position={currentPosition}
					token={mapboxToken}
					isNavActive={isNavActive}
					route={route}
					category={onStopCategoryChange ? stopCategory ?? null : undefined}
					onCategoryChange={onStopCategoryChange}
					onSelect={onSearchSelect}
					onClose={close}
					onCancelRouting={onCancelRouting}
					title={searchTitle}
				/>
			)}
			{panel === "settings" && (
				<Box
					role="region"
					aria-label="Settings"
					sx={{
						...topSheetSx,
						maxHeight: "min(820px, 45vh)",
						overflowY: "auto",
					}}
				>
					<Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
						<Typography sx={{ fontSize: 32, fontWeight: 800 }}>Settings</Typography>
						<DriveButton aria-label="Close panel" onClick={close}><CloseRounded /></DriveButton>
					</Box>
					<Box sx={{ display: "grid", gap: 1.5, "& .settings-option": { minHeight: "clamp(76px, 8vw, 88px)", minWidth: 0, px: 1, fontSize: "clamp(19px, 2.4vw, 26px)" } }}>
						<Box><Typography sx={{ fontSize: 25, fontWeight: 700 }}>Appearance</Typography><Typography sx={{ fontSize: 20, color: "text.secondary" }}>{reason}</Typography></Box>
						<Box role="group" aria-label="Time of day" sx={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 1 }}>
							{THEME_PREFERENCES.map((value) => <DriveButton className="settings-option" key={value} variant={preference === value ? "contained" : "outlined"} aria-pressed={preference === value} onClick={() => setPreference(value)}>{value[0].toUpperCase() + value.slice(1)}</DriveButton>)}
						</Box>
						<Box><Typography sx={{ fontSize: 25, fontWeight: 700 }}>Map weather</Typography><Typography sx={{ fontSize: 20, color: "text.secondary" }}>Auto follows local weather; other choices preview map effects.</Typography></Box>
						<Box role="group" aria-label="Map weather" sx={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 1 }}>
							{(["auto", "clear", "rain", "snow"] as const).map((value) => <DriveButton className="settings-option" key={value} variant={weatherAppearance === value ? "contained" : "outlined"} aria-pressed={weatherAppearance === value} onClick={() => setWeatherAppearance(value)}>{value[0].toUpperCase() + value.slice(1)}</DriveButton>)}
						</Box>
						{onVoiceEngineChange && <><Box><Typography sx={{ fontSize: 25, fontWeight: 700 }}>Guidance voice</Typography>{voiceStatus && <Typography sx={{ fontSize: 20, color: "text.secondary" }}>{voiceStatus}</Typography>}</Box><Box role="group" aria-label="Guidance voice" sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>{([ ["natural", "Natural"], ["system", "System"] ] as const).map(([value, label]) => <DriveButton key={value} className="settings-option" variant={voiceEngine === value ? "contained" : "outlined"} aria-pressed={voiceEngine === value} onClick={() => onVoiceEngineChange(value)}>{label}</DriveButton>)}</Box>{onVoiceVolumeChange && <Box role="group" aria-label="Guidance volume" sx={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", alignItems: "center", gap: 1 }}><DriveButton className="settings-option" variant="outlined" aria-label="Volume down" disabled={voiceVolume <= 0.1} onClick={() => onVoiceVolumeChange(Math.max(0.1, Math.round((voiceVolume - 0.1) * 10) / 10))} sx={{ minWidth: 88 }}><VolumeDownRounded /></DriveButton><Typography aria-live="polite" sx={{ fontSize: 28, fontWeight: 800, textAlign: "center" }}>{Math.round(voiceVolume * 100)}%</Typography><DriveButton className="settings-option" variant="outlined" aria-label="Volume up" disabled={voiceVolume >= 1} onClick={() => onVoiceVolumeChange(Math.min(1, Math.round((voiceVolume + 0.1) * 10) / 10))} sx={{ minWidth: 88 }}><VolumeUpRounded /></DriveButton>{onTestVoice && <DriveButton className="settings-option" variant="contained" onClick={onTestVoice} sx={{ minWidth: 88 }}>Test</DriveButton>}</Box>}</>}
						{onShowTrafficChange && <><Box><Typography sx={{ fontSize: 25, fontWeight: 700 }}>Live traffic</Typography><Typography sx={{ fontSize: 20, color: "text.secondary" }}>Orange and red roads show slow and heavy traffic.</Typography></Box><Box role="group" aria-label="Live traffic" sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>{([ [true, "Show"], [false, "Hide"] ] as const).map(([value, label]) => <DriveButton key={label} className="settings-option" variant={showTraffic === value ? "contained" : "outlined"} aria-pressed={showTraffic === value} onClick={() => onShowTrafficChange(value)}>{label}</DriveButton>)}</Box></>}
						{onRoutePreferencesChange && <><Typography sx={{ fontSize: 25, fontWeight: 700 }}>Avoid on routes</Typography><Typography sx={{ fontSize: 20, color: "text.secondary" }}>Applies to new Mapbox routes.</Typography><Box role="group" aria-label="Route preferences" sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>{([ ["toll", "Tolls"], ["ferry", "Ferries"], ["unpaved", "Unpaved"] ] as const).map(([value, label]) => <DriveButton key={value} className="settings-option" disabled={isDriving || provider !== "mapbox"} aria-pressed={routePreferences.includes(value)} variant={routePreferences.includes(value) ? "contained" : "outlined"} onClick={() => onRoutePreferencesChange(routePreferences.includes(value) ? routePreferences.filter(item => item !== value) : [...routePreferences, value])}>{label}</DriveButton>)}</Box></>}
						{onSetPlace && <>
							<Typography sx={{ fontSize: 25, fontWeight: 700, pt: 1 }}>Saved places</Typography>
							<Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
								<DriveButton className="settings-option" variant="outlined" onClick={() => onSetPlace("home")}>Change Home</DriveButton>
								<DriveButton className="settings-option" variant="outlined" onClick={() => onSetPlace("work")}>Change Work</DriveButton>
							</Box>
						</>}
						{/* Rarely needed and easy to hit by mistake, so kept behind one extra tap. */}
						<DriveButton className="settings-option" color="inherit" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)} sx={{ justifyContent: "space-between", px: 2 }}>Advanced<ExpandMoreRounded sx={{ transform: advancedOpen ? "rotate(180deg)" : "none" }} /></DriveButton>
						{advancedOpen && <>
							<DriveButton className="settings-option" variant="outlined" onClick={onToggleProvider}>Routing: {provider === "mapbox" ? "Mapbox online" : "Valhalla local"}</DriveButton>
							<Typography sx={{ fontSize: 20, color: "text.secondary" }}>Local routing requires Valhalla. Place search needs internet.</Typography>
							<DriveButton className="settings-option" color="error" onClick={() => ipcRenderer.send("app-quit")}>Exit app</DriveButton>
						</>}
					</Box>
				</Box>
			)}
		</>
	);
}
