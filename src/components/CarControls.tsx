import React, { useEffect, useRef, useState } from "react";
import { isBool, isNumberIn, usePersistentState } from "../lib/usePersistentState";
import { Box, Typography } from "@mui/material";
import { alpha, type Theme } from "@mui/material/styles";
import { keyframes } from "@emotion/react";
import AcUnitRounded from "@mui/icons-material/AcUnitRounded";
import AirRounded from "@mui/icons-material/AirRounded";
import DeviceThermostatRounded from "@mui/icons-material/DeviceThermostatRounded";
import ChevronLeftRounded from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import VolumeUpRounded from "@mui/icons-material/VolumeUpRounded";
import PauseRounded from "@mui/icons-material/PauseRounded";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import SkipNextRounded from "@mui/icons-material/SkipNextRounded";
import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import MusicNoteRounded from "@mui/icons-material/MusicNoteRounded";
import DriveButton from "./DriveButton";
import SpotifyPopup from "./SpotifyPopup";
import QuietNotice from "./QuietNotice";
import { useSpotify } from "../hooks/useSpotify";
import { useKeyboard } from "../contexts/KeyboardContext";
import { audioDucking, duckedVolume } from "../lib/audioDucking";
import RearDefrostIcon from "../../public/icons/rearWindshieldDefrost.svg";
import AirflowFaceIcon from "../../public/icons/airflowFace.svg";
import AirflowFaceFeetIcon from "../../public/icons/airflowFaceFeet.svg";
import AirflowFeetIcon from "../../public/icons/airflowFeet.svg";
import AirflowFeetScreenIcon from "../../public/icons/airflowFeetScreen.svg";
import AirflowScreenIcon from "../../public/icons/airflowScreen.svg";
import RecirculateIcon from "../../public/icons/carFanOutIn.svg";

// Flip when a real vehicle interface (CAN/serial) drives these controls.
const VEHICLE_CONNECTED = false;
/**
 * Where the fan blows, in the order a car steps through them. The pictograms are the standard
 * ones: a seated person with arrows to the face and feet, and the windscreen symbol for demisting
 * (Material Symbols "car fan" and "car defrost" icons, Apache 2.0).
 */
const AIRFLOW_MODES = [
	{ name: "face", Icon: AirflowFaceIcon },
	{ name: "face and feet", Icon: AirflowFaceFeetIcon },
	{ name: "feet", Icon: AirflowFeetIcon },
	{ name: "feet and windscreen", Icon: AirflowFeetScreenIcon },
	{ name: "windscreen", Icon: AirflowScreenIcon },
] as const;

// Hazard flashers blink about 75 times a minute; the screen edge, the banner and the dock button all share this one clock so they flash together.
const HAZARD_PERIOD = "0.8s";
const hazardPulse = keyframes`0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; }`;
const hazardTint = keyframes`0%, 49% { background-color: rgba(211, 47, 47, 0.5); } 50%, 100% { background-color: rgba(211, 47, 47, 0.12); }`;
/** Flashes red around the whole screen with a banner, so hazards are unmistakable from any seat. Never blocks touches. */
function HazardOverlay() {
 return <Box role="alert" aria-label="Hazards flashing" sx={{ position: "fixed", inset: 0, zIndex: 9990, pointerEvents: "none" }}>
  <Box sx={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 200px 30px rgba(255, 31, 31, 0.7)", animation: `${hazardPulse} ${HAZARD_PERIOD} step-end infinite` }} />
  <Box sx={{ position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 1.5, px: 3, py: 0.25, borderRadius: 8, bgcolor: "#d32f2f", color: "#fff", boxShadow: 6, animation: `${hazardPulse} ${HAZARD_PERIOD} step-end infinite` }}>
   <WarningAmberRounded sx={{ fontSize: 34 }} />
   <Typography sx={{ fontSize: 26, fontWeight: 800, letterSpacing: 1 }}>HAZARD</Typography>
   <WarningAmberRounded sx={{ fontSize: 34 }} />
  </Box>
 </Box>;
}

interface Props { /** Shown above the dock at the right (the speed signs). */ overlay?: React.ReactNode; isDriving: boolean; panel: "media" | null; setPanel: (panel: "media" | null) => void }
interface StepControlProps { label: string; /** Shown beside the value instead of the label, which stays as the accessible name. */ icon?: React.ElementType; value: number; onChange: (value: number) => void; maximum: number; step?: number; displayValue?: string; /** A picture of the value, shown under the number. */ meter?: React.ReactNode; /** Share of the row, relative to the other steppers. */ grow?: number; disabled?: boolean; className?: string }
/** The ‹ › beside a value: flat chevrons with the value as the centre of the cell. */
const CHEVRON_BUTTON = { flex: "0 0 56px", minWidth: 0, minHeight: 96, borderRadius: 0, color: "text.secondary", "&:hover": { bgcolor: "action.hover", color: "text.primary" }, "& .MuiSvgIcon-root": { fontSize: 40 } } as const;
function StepControl({ label, icon: Icon, value, onChange, maximum, step = 1, displayValue, meter, grow = 1, disabled, className }: StepControlProps) {
 return <Box className={className} sx={{ display: "flex", alignItems: "stretch", flex: `${grow} 1 0`, minWidth: 0 }}>
  <DriveButton color="inherit" sx={CHEVRON_BUTTON} aria-label={`Decrease ${label.toLowerCase()}`} disabled={disabled || value <= 0} onClick={() => onChange(Math.max(0, value - step))}><ChevronLeftRounded /></DriveButton>
  <Box sx={{ flex: 1, minWidth: 0, display: "grid", alignContent: "center", justifyItems: "center", gap: 0.25, px: 0.5 }}>
   <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
    {Icon && <Icon aria-hidden sx={{ fontSize: 30, color: "text.secondary" }} />}
    <Typography aria-live="polite" sx={{ fontSize: 36, fontWeight: 500, lineHeight: 1.05, letterSpacing: "-0.5px" }}>{displayValue ?? value}</Typography>
   </Box>
   {meter}
  </Box>
  <DriveButton color="inherit" sx={CHEVRON_BUTTON} aria-label={`Increase ${label.toLowerCase()}`} disabled={disabled || value >= maximum} onClick={() => onChange(Math.min(maximum, value + step))}><ChevronRightRounded /></DriveButton>
 </Box>;
}

/** Cool to warm: a blue-to-orange scale with a marker at the current setting. */
function WarmthMeter({ value }: { value: number }) {
 return <Box aria-hidden sx={{ position: "relative", width: "80%", maxWidth: 160, height: 8, mt: 0.5, borderRadius: 6, background: "linear-gradient(90deg, #38BDF8, #FFD166 55%, #FF7A3D)" }}>
  <Box sx={{ position: "absolute", top: -5, left: `calc(${value * 10}% - 9px)`, width: 18, height: 18, borderRadius: "50%", bgcolor: "#fff", border: "3px solid", borderColor: "background.default", boxSizing: "border-box", boxShadow: "0 0 0 2px #fff" }} />
 </Box>;
}
/** Fan strength: ten bars that grow taller, lit up to the current setting. */
function FanMeter({ value }: { value: number }) {
 return <Box aria-hidden sx={{ display: "flex", alignItems: "flex-end", gap: "4px", width: "70%", maxWidth: 140, height: 20, mt: 0.25 }}>
  {Array.from({ length: 10 }, (_, index) => <Box key={index} sx={{ flex: 1, height: `${30 + index * 7.8}%`, borderRadius: "3px", bgcolor: index < value ? "primary.main" : "text.disabled", opacity: index < value ? 1 : 0.45 }} />)}
 </Box>;
}

/**
 * A flat, icon-only switch for the dock bar: no fill, no rounding and no hover effect. A bar runs flush
 * along the bottom edge only while it is on, in the accent colour.
 * Without `pressed` it is a plain button (the airflow one, which steps through settings rather than
 * switching on and off) and never shows the bar. The hazards use the red tone: red even when off, and
 * tinted as well as barred when on.
 */
function Switch({ label, pressed, onClick, children, width, className, tone = "primary" }: { label: string; pressed?: boolean; onClick: () => void; children: React.ReactNode; width?: number; className?: string; tone?: "primary" | "error" }) {
 const on = pressed === true;
 const background = on && tone === "error" ? (theme: Theme) => alpha(theme.palette.error.main, 0.2) : "transparent";
 return <DriveButton className={className} aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}
  sx={{ flex: width ? `0 0 ${width}px` : 1, minWidth: 0, minHeight: 96, borderRadius: 0,
   color: on ? `${tone}.main` : tone === "error" ? "error.main" : "text.primary",
   bgcolor: background, "&:hover": { bgcolor: background },
   ...(on && tone === "error" ? { animation: `${hazardTint} ${HAZARD_PERIOD} step-end infinite`, "& .MuiSvgIcon-root": { fontSize: 46 } } : {}),
   // A pseudo-element rather than a shadow, so no hover, focus or ripple state can paint over it.
   "&::after": on ? { content: '""', position: "absolute", left: 0, right: 0, bottom: 0, height: 6, zIndex: 1, bgcolor: (theme: Theme) => theme.palette[tone].main, pointerEvents: "none" } : undefined,
   ...(on && tone === "error" ? {} : { "& .MuiSvgIcon-root": { fontSize: 46 } }) }}>
  {children}
 </DriveButton>;
}

export default function CarControls({ overlay, isDriving, panel: tab, setPanel: setTab }: Props) {
 const spotify = useSpotify();
 const spotifyRef = useRef(spotify);
 spotifyRef.current = spotify;
 // The level the music was at before a spoken prompt lowered it; null when it is not lowered.
 const duckedFrom = useRef<number | null>(null);
 // Lower the music while navigation speaks, then put it back exactly where it was.
 useEffect(() => audioDucking.subscribe((ducked: boolean): void => {
  const music = spotifyRef.current;
  if (ducked) {
   if (duckedFrom.current !== null || !music.isConnected || !music.track?.isPlaying || music.volume <= 0) return;
   duckedFrom.current = music.volume;
   void music.setVolume(duckedVolume(music.volume)).catch(() => { duckedFrom.current = null; });
  } else if (duckedFrom.current !== null) {
   const restore = duckedFrom.current;
   duckedFrom.current = null;
   void music.setVolume(restore).catch((): void => { /* Keep playing at the lowered level. */ });
  }
 }), []);
 const { hideKeyboard } = useKeyboard();
 // Climate settings are remembered between drives (hazards deliberately are not).
 const [temp, setTemp] = usePersistentState("brava-climate-temp", 5, isNumberIn(0, 100));
 const [fan, setFan] = usePersistentState("brava-climate-fan", 3, isNumberIn(0, 20));
 const [hazards, setHazards] = useState(false);
 const [ac, setAc] = usePersistentState("brava-climate-ac", false, isBool);
 const [recirculate, setRecirculate] = usePersistentState("brava-climate-recirculate", false, isBool);
 const [airflow, setAirflow] = usePersistentState("brava-climate-airflow", 0, isNumberIn(0, 20));
 const [rearDemist, setRearDemist] = usePersistentState("brava-climate-rear-demist", false, isBool);
 const [error, setError] = useState<string | null>(null);
 // Which way the air blows, named for a moment after each change: the icon alone does not say.
 const [airflowNote, setAirflowNote] = useState<string | null>(null);
 useEffect(() => { if (!error) return; const timer = window.setTimeout(() => setError(null), 6000); return () => window.clearTimeout(timer); }, [error]);
 useEffect(() => { if (!airflowNote) return; const timer = window.setTimeout(() => setAirflowNote(null), 1800); return () => window.clearTimeout(timer); }, [airflowNote]);
 const ready = spotify.isConnected && spotify.track !== null;
 useEffect(() => { if (isDriving) { setTab(null); hideKeyboard(); } }, [isDriving, hideKeyboard, setTab]);
 async function mediaAction(action: () => Promise<void>) {
  setError(null);
  try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Playback unavailable. Try again."); }
 }
 // Until a real vehicle link exists these only change what the screen shows.
 const suffix = VEHICLE_CONNECTED ? "" : " (preview)";
 return <Box component="footer" data-dock aria-label="Dashboard controls" sx={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20, display: "flex", flexDirection: "column", gap: 0, p: 0, pointerEvents: "none", "& > *": { pointerEvents: "auto" } }}>
  {hazards && <HazardOverlay />}
  {overlay && <Box sx={{ alignSelf: "flex-end", px: 2, pb: 1.5, "&&": { pointerEvents: "none" } }}>{overlay}</Box>}
  {error && <Box sx={{ mx: 2, mb: 1.5 }}><QuietNotice onClose={() => setError(null)}>{error}</QuietNotice></Box>}
  {tab && <Box role="region" id="dashboard-panel" data-map-obstruction aria-label="media controls" sx={{ maxHeight: "min(50vh, 760px)", overflowY: "auto", position: "relative", mx: 2, mb: 1.5, bgcolor: (theme) => alpha(theme.palette.background.paper, 0.92), backdropFilter: "blur(12px)", border: "1px solid", borderColor: "divider", borderRadius: 3, boxShadow: 8, p: 1.5 }}>
   <SpotifyPopup spotify={spotify} isDriving={isDriving} onClose={() => setTab(null)} />
  </Box>}
  {/* The music card floats over the map and is hidden while the full player is open (the player has its own volume); tap the track to open it. */}
  {tab !== "media" && <Box sx={{ alignSelf: "flex-start", display: "flex", alignItems: "center", mx: 2, mb: 1.5, maxWidth: "calc(100% - 32px)", bgcolor: (theme) => alpha(theme.palette.background.paper, 0.92), backdropFilter: "blur(12px)", border: "1px solid", borderColor: "divider", borderRadius: 3, boxShadow: 6, px: 1.5, py: 0.5, gap: 0.5, "& .MuiButton-root": { minHeight: 72 } }}>
   {spotify.isConnected ? <>
    {spotify.track?.albumArt && <Box component="img" src={spotify.track.albumArt} alt="" sx={{ width: 56, height: 56, objectFit: "cover", borderRadius: 2, flexShrink: 0, mr: 0.5 }} />}
    <DriveButton color="inherit" aria-label="Expand music player" onClick={() => { hideKeyboard(); setTab(tab === "media" ? null : "media"); }} sx={{ flex: "1 1 auto", minWidth: 0, justifyContent: "flex-start", textAlign: "left" }}><Typography noWrap sx={{ fontSize: 26, fontWeight: 700, minWidth: 0 }}>{spotify.track?.name ?? "Music"}{spotify.track?.artists && <Box component="span" sx={{ fontWeight: 500, color: "text.secondary" }}> · {spotify.track.artists}</Box>}{!spotify.track && <Box component="span" sx={{ fontWeight: 500, color: "text.secondary" }}> · No active playback</Box>}</Typography></DriveButton>
    <DriveButton color="inherit" disabled={!spotify.isConnected} aria-label={spotify.track?.isPlaying ? "Pause music" : "Play music"} onClick={() => mediaAction(spotify.track?.isPlaying ? spotify.pause : spotify.play)}>{spotify.track?.isPlaying ? <PauseRounded /> : <PlayArrowRounded />}</DriveButton>
    <DriveButton color="inherit" disabled={!ready} aria-label="Next track" onClick={() => mediaAction(spotify.next)}><SkipNextRounded /></DriveButton>
    <Box sx={{ width: "1px", alignSelf: "stretch", my: 1.5, bgcolor: "divider", mx: 0.5 }} />
    <DriveButton color="inherit" sx={{ minWidth: 0, flex: "0 0 52px" }} aria-label="Decrease volume" disabled={spotify.volume <= 0} onClick={() => mediaAction(() => spotify.setVolume(Math.max(0, Math.ceil(spotify.volume / 10) * 10 - 10)))}><ChevronLeftRounded /></DriveButton>
    <Box aria-live="polite" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5, minWidth: 92 }}><VolumeUpRounded sx={{ fontSize: 30, color: "text.secondary" }} /><Typography sx={{ fontSize: 28, fontWeight: 500 }}>{spotify.volume}</Typography></Box>
    <DriveButton color="inherit" sx={{ minWidth: 0, flex: "0 0 52px" }} aria-label="Increase volume" disabled={spotify.volume >= 100} onClick={() => mediaAction(() => spotify.setVolume(Math.min(100, Math.floor(spotify.volume / 10) * 10 + 10)))}><ChevronRightRounded /></DriveButton>
   </> : <DriveButton color="inherit" aria-label="Open music player" onClick={() => { hideKeyboard(); setTab(tab === "media" ? null : "media"); }} sx={{ justifyContent: "flex-start", gap: 1, fontSize: 24 }}><MusicNoteRounded /> Connect Spotify</DriveButton>}
  </Box>}
  <Box component="nav" aria-label="Climate and safety controls" sx={{ bgcolor: "background.paper", color: "text.primary", borderTop: "1px solid", borderColor: "divider", display: "flex", alignItems: "stretch", position: "relative", borderTopLeftRadius: 20, borderTopRightRadius: 20, "& .dock-start": { borderTopLeftRadius: 20, overflow: "hidden" }, "& .dock-end": { borderTopRightRadius: 20 } }}>
   {airflowNote && <Box role="status" sx={{ position: "absolute", left: "50%", bottom: "calc(100% + 112px)", transform: "translateX(-50%)", px: 3, py: 1, borderRadius: 8, bgcolor: (theme) => alpha(theme.palette.background.paper, 0.95), backdropFilter: "blur(12px)", border: "1px solid", borderColor: "divider", boxShadow: 6, fontSize: 24, fontWeight: 600, whiteSpace: "nowrap" }}>Air to {airflowNote}</Box>}
   {/* One bar, Tesla style: the driver sits on the right, so the hazards and warmth are at that end, the air settings in the middle, and the fan at the left. */}
   <StepControl className="dock-start" label="Fan" icon={AirRounded} grow={1} value={fan} onChange={setFan} maximum={10} displayValue={fan === 0 ? "Off" : fan + "/10"} meter={<FanMeter value={fan} />} />
   <Box sx={{ display: "flex", alignItems: "stretch", flex: "0 0 auto" }}>
    <Switch width={88} label={`Airflow direction: ${AIRFLOW_MODES[airflow].name}${suffix}`} onClick={() => { const next = (airflow + 1) % AIRFLOW_MODES.length; setAirflow(next); setAirflowNote(AIRFLOW_MODES[next].name); }}>
     {React.createElement(AIRFLOW_MODES[airflow].Icon, { width: 46, height: 46, fill: "currentColor", "aria-hidden": true })}
    </Switch>
    <Switch width={88} label={`Recirculate cabin air${suffix}`} pressed={recirculate} onClick={() => setRecirculate(!recirculate)}><RecirculateIcon width={46} height={46} fill="currentColor" /></Switch>
    <Switch width={88} label={`Rear demist${suffix}`} pressed={rearDemist} onClick={() => setRearDemist(!rearDemist)}><RearDefrostIcon width={46} height={46} fill="currentColor" /></Switch>
    <Switch width={88} label={`Air conditioning${suffix}`} pressed={ac} onClick={() => setAc(!ac)}><AcUnitRounded /></Switch>
   </Box>
   <StepControl label="Warmth" icon={DeviceThermostatRounded} grow={1} value={temp} onChange={setTemp} maximum={10} displayValue={temp === 0 ? "Cool" : temp === 10 ? "Warm" : temp + "/10"} meter={<WarmthMeter value={temp} />} />
   <Switch className="dock-end" tone="error" width={96} label={`Hazard lights${suffix}`} pressed={hazards} onClick={() => setHazards(!hazards)}><WarningAmberRounded /></Switch>
  </Box>
 </Box>;
}
