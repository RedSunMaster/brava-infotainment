import { ipcRenderer } from "electron";
import React, { useEffect, useState } from "react";
import { isBool, usePersistentState } from "../lib/usePersistentState";
import { INAPP_PLAYER_EVENT, INAPP_PLAYER_KEY, RESUME_KEY } from "../hooks/useSpotify";
import {
	Box,
	Typography,
} from "@mui/material";
import type { CameraMode, Orientation, RoutingProvider } from "../constants";
import CloseRounded from "@mui/icons-material/CloseRounded";
import ExploreRounded from "@mui/icons-material/ExploreRounded";
import MyLocationRounded from "@mui/icons-material/MyLocationRounded";
import NavigationRounded from "@mui/icons-material/NavigationRounded";
import RouteRounded from "@mui/icons-material/RouteRounded";
import PlaceRounded from "@mui/icons-material/PlaceRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import SettingsRounded from "@mui/icons-material/SettingsRounded";
import { useThemeMode } from "../ThemeContext";
import { THEME_PREFERENCES } from "../lib/ambientTheme";
import { resolveWeather, WEATHER_APPEARANCES, WEATHER_LABELS, type WeatherAppearance, type WeatherKind } from "../lib/mapStyle";
import PaletteRounded from "@mui/icons-material/PaletteRounded";
import MusicNoteRounded from "@mui/icons-material/MusicNoteRounded";
import TuneRounded from "@mui/icons-material/TuneRounded";
import AutoModeRounded from "@mui/icons-material/AutoModeRounded";
import WbSunnyRounded from "@mui/icons-material/WbSunnyRounded";
import WbCloudyRounded from "@mui/icons-material/WbCloudyRounded";
import CloudRounded from "@mui/icons-material/CloudRounded";
import BlurOnRounded from "@mui/icons-material/BlurOnRounded";
import GrainRounded from "@mui/icons-material/GrainRounded";
import WaterDropRounded from "@mui/icons-material/WaterDropRounded";
import ThunderstormRounded from "@mui/icons-material/ThunderstormRounded";
import AcUnitRounded from "@mui/icons-material/AcUnitRounded";
import AirRounded from "@mui/icons-material/AirRounded";
import SatelliteAltRounded from "@mui/icons-material/SatelliteAltRounded";
import VoiceVolumes from "./VoiceVolumes";
import PhoneSettings from "./PhoneSettings";
import PhoneAndroidRounded from "@mui/icons-material/PhoneAndroidRounded";
import GpsDebugPanel from "./GpsDebugPanel";
import BluetoothPanel from "./BluetoothPanel";
import BluetoothRounded from "@mui/icons-material/BluetoothRounded";
import type { GpsStatus } from "../hooks/useGps";
import { useKeyboard } from "../contexts/KeyboardContext";
import DriveButton from "./DriveButton";
import DestinationSearch, { topSheetSx } from "./DestinationSearch";
import type { PlaceSlot, PlaceTarget, SavedPlaces } from "../lib/savedPlaces";
import { defaultMarker } from "../lib/savedPlaces";
import type { Favourite } from "../lib/favourites";
import type { RoutePreference } from "../lib/routing";
import type { PlaceDetails, Coordinates } from "../lib/locationSearch";
type SettingsTab = "display" | "sound" | "drive" | "places" | "gps" | "bluetooth" | "phone" | "system";
const SETTINGS_TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
	{ id: "display", label: "Display", icon: <PaletteRounded /> },
	{ id: "sound", label: "Sound", icon: <MusicNoteRounded /> },
	{ id: "drive", label: "Driving", icon: <RouteRounded /> },
	{ id: "places", label: "Places", icon: <PlaceRounded /> },
	{ id: "gps", label: "GPS", icon: <SatelliteAltRounded /> },
	{ id: "bluetooth", label: "Bluetooth", icon: <BluetoothRounded /> },
	{ id: "phone", label: "Phone", icon: <PhoneAndroidRounded /> },
	{ id: "system", label: "System", icon: <TuneRounded /> },
];
const WEATHER_ICONS: Record<WeatherAppearance, React.ReactNode> = {
	auto: <AutoModeRounded />, clear: <WbSunnyRounded />, partly: <WbCloudyRounded />, overcast: <CloudRounded />, fog: <BlurOnRounded />,
	drizzle: <GrainRounded />, rain: <WaterDropRounded />, storm: <ThunderstormRounded />, snow: <AcUnitRounded />, blizzard: <AirRounded />,
};
const WEATHER_SHORT: Record<WeatherKind, string> = {
	clear: "Clear", partly: "Partly cloudy", overcast: "Overcast", fog: "Fog", drizzle: "Drizzle", rain: "Rain", storm: "Storm", snow: "Snow", blizzard: "Blizzard",
};

function Section({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
	return (
		<Box sx={{ display: "grid", gap: 1.25 }}>
			<Box><Typography sx={{ fontSize: 25, fontWeight: 700 }}>{title}</Typography>{hint && <Typography sx={{ fontSize: 20, color: "text.secondary" }}>{hint}</Typography>}</Box>
			{children}
		</Box>
	);
}

/** One saved place: its map pin (tap to change), its name, and what can be done with it. */
function PlaceRow({ marker, title, subtitle, label, onMarker, onGo, onEdit, editLabel, onRemove }: { marker: string; title: string; subtitle?: string; label: string; onMarker?: () => void; onGo?: () => void; onEdit?: () => void; editLabel?: string; onRemove?: () => void }) {
	return (
		<Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
			<DriveButton color="inherit" variant="outlined" disabled={!onMarker} aria-label={`Change ${label} pin`} onClick={onMarker} sx={{ minWidth: 72, fontSize: 32, p: 0 }}>{marker}</DriveButton>
			<Box sx={{ flex: 1, minWidth: 0 }}>
				<Typography noWrap sx={{ fontSize: 24, fontWeight: 700, color: onGo || onEdit ? "text.primary" : "text.secondary" }}>{title}</Typography>
				{subtitle && <Typography noWrap sx={{ fontSize: 19, color: "text.secondary" }}>{subtitle}</Typography>}
			</Box>
			{onGo && <DriveButton color="inherit" variant="outlined" aria-label={`Navigate to ${label}`} onClick={onGo}>Go</DriveButton>}
			{onEdit && <DriveButton color="inherit" variant="outlined" onClick={onEdit}>{editLabel}</DriveButton>}
			{onRemove && <DriveButton color="error" variant="outlined" aria-label={`Remove ${label}`} onClick={onRemove}>Remove</DriveButton>}
		</Box>
	);
}

/** A row of mutually exclusive choices. */
function Options<T extends string | boolean>({ label, columns, value, onChange, items }: { label: string; columns: number; value: T; onChange: (value: T) => void; items: readonly (readonly [T, string])[] }) {
	return (
		<Box role="group" aria-label={label} sx={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 1 }}>
			{items.map(([item, text]) => <DriveButton key={String(item)} className="settings-option" variant={value === item ? "contained" : "outlined"} aria-pressed={value === item} onClick={() => onChange(item)}>{text}</DriveButton>)}
		</Box>
	);
}

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
	/** Home and Work shortcuts, shown beside the other map buttons while idle. */
	quickPlaces?: React.ReactNode;
	/** Stop-category buttons that sit beside Add stop while navigating. */
	quickStops?: React.ReactNode;
	/** Extra buttons shown with the map utilities (navigation only). */
	extraActions?: React.ReactNode;
	/** Heading for the search panel when it is choosing a saved place. */
	searchTitle?: string;
	/** Opens search to choose the Home or Work address. */
	onSetPlace?: (slot: PlaceTarget) => void;
	savedPlaces?: SavedPlaces;
	favourites?: Favourite[];
	/** Cycles the pin shown on the map for Home, Work or a favourite. */
	onPlaceMarker?: (target: PlaceSlot | { favourite: string }) => void;
	onRemoveFavourite?: (id: string) => void;
	onGoToPlace?: (coords: Coordinates, name: string, buildingCoords?: Coordinates) => void;
	/** Starts dock customising (parked only); the settings sheet closes first. */
	onCustomiseDock?: () => void;
	/** Clouds over the globe during the start-up flight. */
	showClouds?: boolean;
	/** The globe's day and night sides, from the real sun. */
	showNight?: boolean;
	/** The turning globe at start and when parked and idle. */
	globeIdle?: boolean;
	onGlobeIdleChange?: (value: boolean) => void;
	onShowNightChange?: (value: boolean) => void;
	onShowCloudsChange?: (value: boolean) => void;
	/** Where the dock sits, and a way to move it (parked only). */
	dockSide?: "bottom" | "left" | "right";
	onDockSideChange?: (side: "bottom" | "left" | "right") => void;
	hazardAlerts?: boolean;
	onHazardAlertsChange?: (value: boolean) => void;
	/** One-line description of which guidance voice is in use. */
	voiceStatus?: string;
	voiceEngine?: "natural" | "system";
	onVoiceEngineChange?: (engine: "natural" | "system") => void;
	onTestVoice?: () => void;
	onTestAlert?: () => void;
	onTestMessage?: () => void;
	routePreferences?: RoutePreference[];
	showTraffic?: boolean;
	/** Stop category chosen with the quick-stop icons. */
	stopCategory?: string | null;
	onStopCategoryChange?: (category: string | null) => void;
	onShowTrafficChange?: (value: boolean) => void;
	onRoutePreferencesChange?: (values: RoutePreference[]) => void;
	route?: [number, number][];
	/** The app's own view of the GPS, shown beside gpsd's details in Settings → GPS. */
	gpsStatus?: GpsStatus;
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
	quickPlaces,
	quickStops,
	searchTitle,
	onSetPlace,
	savedPlaces = {}, favourites = [], onPlaceMarker, onRemoveFavourite, onGoToPlace,
	hazardAlerts = true, onHazardAlertsChange, onCustomiseDock, dockSide = "bottom", onDockSideChange, showClouds = true, onShowCloudsChange, showNight = true, onShowNightChange, globeIdle = true, onGlobeIdleChange,
	voiceStatus,
	voiceEngine = "natural", onVoiceEngineChange,
	onTestVoice, onTestAlert, onTestMessage,
	routePreferences = [], onRoutePreferencesChange,
	showTraffic = true, onShowTrafficChange,
	stopCategory, onStopCategoryChange,
	route,
	gpsStatus = "disconnected",
}: Props) {
	const [tab, setTab] = useState<SettingsTab>("display");
	const [resumeMusic, setResumeMusic] = usePersistentState(RESUME_KEY, false, isBool);
	const [inAppPlayer, setInAppPlayer] = usePersistentState(INAPP_PLAYER_KEY, true, isBool);
	useEffect(() => { window.dispatchEvent(new Event(INAPP_PLAYER_EVENT)); }, [inAppPlayer]);
	const { hideKeyboard } = useKeyboard();
	const { preference, setPreference, reason, weather, weatherAppearance, setWeatherAppearance } = useThemeMode();
	const autoKind = resolveWeather("auto", weather).kind;

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
				{/* Map utilities sit on the far side; the primary action (Navigate)
				    sits on the driver's side, in line with Start and End. */}
				<Box sx={{ display: "flex", gap: 1, color: "text.primary" }}>
				{(!isNavActive || !isDriving) && <DriveButton className="map-action" color="inherit"
					disabled={isDriving}
					aria-label="Open settings"
					aria-expanded={panel === "settings"}
					variant={panel === "settings" ? "contained" : "text"}
					onClick={() => (panel === "settings" ? close() : setPanel("settings"))}
				>
					<SettingsRounded />
				</DriveButton>}
				{/* One view button: it recentres when the map has been moved away, and otherwise switches
				    between heading-up and north-up. Its icon shows the current view. */}
				{!isNavActive && <DriveButton className="map-action" color="inherit"
					aria-label={cameraMode !== "following" ? "Centre on location" : orientation === "heading" ? "Switch to north up" : "Switch to heading up"}
					onClick={cameraMode !== "following" ? onLocate : onToggleOrientation}
				>
					{cameraMode !== "following" ? <MyLocationRounded /> : orientation === "heading" ? <NavigationRounded /> : <ExploreRounded />}
				</DriveButton>}
				{hasRoute && (
					<DriveButton className="map-action" color="inherit" aria-label="Route overview" onClick={onOverview}>
						<RouteRounded />
					</DriveButton>
				)}
				{!isNavActive && quickPlaces}
				{extraActions}
				</Box>
				<DriveButton className="map-action"
					disabled={isDriving && !isNavActive}
					aria-label={isNavActive ? "Add a stop" : "Choose destination"}
					aria-expanded={panel === "search"}
					onClick={() => (panel === "search" ? close() : setPanel("search"))}
					sx={{ flex: "1 1 400px", minWidth: 200, justifyContent: "flex-start", px: 3 }}
				>
					<SearchRounded />
					<Box component="span" sx={{ ml: 1 }}>
						{isNavActive ? "Add stop" : "Navigate"}
					</Box>
				</DriveButton>
				{isNavActive && quickStops}
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
					data-map-obstruction
					aria-label="Settings"
					sx={{
						...topSheetSx,
						height: "min(820px, 45vh)",
						display: "flex",
						flexDirection: "column",
						gap: 1.5,
						overflow: "hidden",
					}}
				>
					<Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
						<Typography sx={{ fontSize: 32, fontWeight: 800 }}>Settings</Typography>
						<DriveButton aria-label="Close panel" onClick={close}><CloseRounded /></DriveButton>
					</Box>
					<Box sx={{ display: "grid", gridTemplateColumns: "clamp(150px, 20vw, 220px) minmax(0, 1fr)", gap: 2, flex: 1, minHeight: 0, "& .settings-option": { minHeight: "clamp(76px, 8vw, 88px)", minWidth: 0, px: 1, fontSize: "clamp(19px, 2.4vw, 26px)" } }}>
						<Box role="tablist" aria-label="Settings sections" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
							{SETTINGS_TABS.map(({ id, label, icon }) => <DriveButton key={id} role="tab" aria-selected={tab === id} color="inherit" variant={tab === id ? "contained" : "text"} onClick={() => setTab(id)} sx={{ justifyContent: "flex-start", gap: 1.5, px: 2, minHeight: 80, ...(tab === id ? {} : { color: "text.secondary" }) }}>{icon}{label}</DriveButton>)}
						</Box>
						<Box role="tabpanel" sx={{ display: "grid", gap: 3, alignContent: "start", overflowY: "auto", minHeight: 0, pr: 0.5 }}>
							{tab === "display" && <>
								<Section title="Time of day" hint={reason}>
									<Options label="Time of day" columns={5} value={preference} onChange={setPreference} items={THEME_PREFERENCES.map((value) => [value, value[0].toUpperCase() + value.slice(1)] as const)} />
								</Section>
								<Section title="Map weather" hint={weatherAppearance === "auto" ? `Following local weather: ${WEATHER_LABELS[autoKind]}. Pick any other to preview it.` : `Previewing ${WEATHER_LABELS[weatherAppearance as WeatherKind]}. Choose Auto to follow local weather.`}>
									<Box role="group" aria-label="Map weather" sx={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 1 }}>
										{WEATHER_APPEARANCES.map((value) => <DriveButton key={value} className="settings-option" variant={weatherAppearance === value ? "contained" : "outlined"} aria-pressed={weatherAppearance === value} onClick={() => setWeatherAppearance(value)} sx={{ flexDirection: "column", gap: 0.5, py: 1, fontSize: "clamp(16px, 1.9vw, 21px)", lineHeight: 1.1, "& .MuiSvgIcon-root": { fontSize: "clamp(28px, 3.2vw, 38px)" } }}>{WEATHER_ICONS[value]}{value === "auto" ? "Auto" : WEATHER_SHORT[value]}</DriveButton>)}
									</Box>
								</Section>
								{onShowCloudsChange && <Section title="Earth clouds" hint="Clouds over the globe during the start-up flight.">
									<Options<boolean> label="Earth clouds" columns={2} value={showClouds} onChange={onShowCloudsChange} items={[[true, "Show"], [false, "Hide"]] as const} />
								</Section>}
								{onGlobeIdleChange && <Section title="Turning globe" hint="Starts on the Earth turning in space, then flies to your car when you use destinations or drive. Goes back to the globe after the car has been parked and untouched for five minutes.">
									<Options<boolean> label="Turning globe" columns={2} value={globeIdle} onChange={onGlobeIdleChange} items={[[true, "Show"], [false, "Off"]] as const} />
								</Section>}
								{onShowNightChange && <Section title="Day and night on the globe" hint="Shows which side of the Earth is in daylight, dusk or night right now, from the real position of the sun.">
									<Options<boolean> label="Day and night on the globe" columns={2} value={showNight} onChange={onShowNightChange} items={[[true, "Show"], [false, "Hide"]] as const} />
								</Section>}
								{onCustomiseDock && <Section title="Dock" hint="Choose where the dock sits, and which controls are in it, how big they are and in what order. Only while parked.">
									{onDockSideChange && <Options<"bottom" | "left" | "right"> label="Dock position" columns={3} value={dockSide} onChange={(value) => { if (!isDriving) onDockSideChange(value); }} items={[["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]] as const} />}
									<DriveButton className="settings-option" variant="outlined" disabled={isDriving} onClick={() => { setPanel(null); onCustomiseDock(); }}>Customise dock</DriveButton>
								</Section>}
							</>}
							{tab === "sound" && <>
								{onVoiceEngineChange && <Section title="Guidance voice" hint={`${voiceStatus ?? ""} The master volume is on the music player.`.trim()}>
									<Options label="Guidance voice" columns={2} value={voiceEngine} onChange={onVoiceEngineChange} items={[["natural", "Natural"], ["system", "System"]] as const} />
									<VoiceVolumes onTestGuidance={onTestVoice} onTestAlert={onTestAlert} onTestMessage={onTestMessage} />
								</Section>}
								<Section title="Music on start" hint="Carry on with your last music a few seconds after the app starts. Never interrupts another device that is already playing.">
									<Options<boolean> label="Music on start" columns={2} value={resumeMusic} onChange={setResumeMusic} items={[[true, "Resume"], [false, "Wait for me"]] as const} />
								</Section>
								<Section title="Music player" hint="Play inside this app, or control the Spotify app already running on this device.">
									<Options<boolean> label="Music player" columns={2} value={inAppPlayer} onChange={setInAppPlayer} items={[[true, "In this app"], [false, "Spotify app"]] as const} />
								</Section>
							</>}
							{tab === "drive" && <>
								{onShowTrafficChange && <Section title="Live traffic" hint="Orange and red roads show slow and heavy traffic.">
									<Options<boolean> label="Live traffic" columns={2} value={showTraffic} onChange={onShowTrafficChange} items={[[true, "Show"], [false, "Hide"]] as const} />
								</Section>}
								{onRoutePreferencesChange && <Section title="Avoid on routes" hint="Applies to new Mapbox routes.">
									<Box role="group" aria-label="Route preferences" sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>{([["toll", "Tolls"], ["ferry", "Ferries"], ["unpaved", "Unpaved"]] as const).map(([value, label]) => <DriveButton key={value} className="settings-option" disabled={isDriving || provider !== "mapbox"} aria-pressed={routePreferences.includes(value)} variant={routePreferences.includes(value) ? "contained" : "outlined"} onClick={() => onRoutePreferencesChange(routePreferences.includes(value) ? routePreferences.filter(item => item !== value) : [...routePreferences, value])}>{label}</DriveButton>)}</Box>
								</Section>}
								{onHazardAlertsChange && <Section title="Cameras and hazards" hint="Warns about speed cameras, red light cameras, railway crossings and mapped hazards on your route. Data from OpenStreetMap; needs internet.">
									<Options<boolean> label="Cameras and hazards" columns={2} value={hazardAlerts} onChange={onHazardAlertsChange} items={[[true, "Warn me"], [false, "Off"]] as const} />
								</Section>}
							</>}
							{tab === "places" && <>
								<Section title="Saved places" hint="Tap a pin to change how it looks on the map.">
									{(["home", "work"] as const).map(slot => {
										const place = savedPlaces[slot];
										return <PlaceRow key={slot} marker={place?.marker ?? defaultMarker(slot)} title={slot === "home" ? "Home" : "Work"} subtitle={place ? place.name : "Not set yet"} label={slot === "home" ? "Home" : "Work"}
											onMarker={place && onPlaceMarker ? () => onPlaceMarker(slot) : undefined}
											onGo={place && onGoToPlace ? () => onGoToPlace(place.coords, place.name, place.buildingCoords) : undefined}
											onEdit={onSetPlace ? () => onSetPlace(slot) : undefined} editLabel={place ? "Change" : "Set"} />;
									})}
								</Section>
								<Section title="Favourites" hint="Each favourite gets its own pin on the building. Tap a pin to choose another.">
									{favourites.map(item => <PlaceRow key={item.id} marker={item.marker} title={item.name.split(",")[0]} subtitle={item.name.split(",").slice(1).join(",").trim()} label={item.name}
										onMarker={onPlaceMarker ? () => onPlaceMarker({ favourite: item.id }) : undefined}
										onGo={onGoToPlace ? () => onGoToPlace(item.coords, item.name, item.buildingCoords) : undefined}
										onRemove={onRemoveFavourite ? () => onRemoveFavourite(item.id) : undefined} />)}
									{onSetPlace && <DriveButton className="settings-option" variant="outlined" onClick={() => onSetPlace("favourite")}>Add favourite</DriveButton>}
								</Section>
							</>}
							{tab === "gps" && <GpsDebugPanel active status={gpsStatus} />}
							{tab === "bluetooth" && <BluetoothPanel active />}
							{tab === "phone" && <PhoneSettings />}
							{tab === "system" && <>
								<Section title="Routing" hint="Local routing requires Valhalla. Place search needs internet.">
									<DriveButton className="settings-option" variant="outlined" onClick={onToggleProvider}>{provider === "mapbox" ? "Mapbox online" : "Valhalla local"}</DriveButton>
								</Section>
								<Section title="Credits">
									<Typography sx={{ fontSize: 20, color: "text.secondary" }}>Globe clouds and night lights: Live Cloud Maps by Matt Eason (CC0), contains modified EUMETSAT data. Earth imagery by NASA.</Typography>
								</Section>
								<Section title="Application">
									<DriveButton className="settings-option" color="error" variant="outlined" onClick={() => ipcRenderer.send("app-quit")}>Exit app</DriveButton>
								</Section>
							</>}
						</Box>
					</Box>
				</Box>
			)}
		</>
	);
}
