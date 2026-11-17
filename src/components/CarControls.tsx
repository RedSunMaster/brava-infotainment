import React, { useEffect, useRef, useState } from "react";
import { Alert, Box, Typography } from "@mui/material";
import AcUnitRounded from "@mui/icons-material/AcUnitRounded";
import AddRounded from "@mui/icons-material/AddRounded";
import RemoveRounded from "@mui/icons-material/RemoveRounded";
import PauseRounded from "@mui/icons-material/PauseRounded";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import SkipNextRounded from "@mui/icons-material/SkipNextRounded";
import VolumeOffRounded from "@mui/icons-material/VolumeOffRounded";
import VolumeUpRounded from "@mui/icons-material/VolumeUpRounded";
import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import MusicNoteRounded from "@mui/icons-material/MusicNoteRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import DriveButton from "./DriveButton";
import SpotifyPopup from "./SpotifyPopup";
import { useSpotify } from "../hooks/useSpotify";
import { useKeyboard } from "../contexts/KeyboardContext";
import { audioDucking, duckedVolume } from "../lib/audioDucking";
import RearDefrostIcon from "../../public/icons/rearWindshieldDefrost.svg";

// Flip when a real vehicle interface (CAN/serial) drives these controls.
const VEHICLE_CONNECTED = false;
interface Props { /** Shown above the dock at the right (the speed signs). */ overlay?: React.ReactNode; isDriving: boolean; panel: "media" | "climate" | null; setPanel: (panel: "media" | "climate" | null) => void }
interface StepControlProps { label: string; value: number; onChange: (value: number) => void; maximum: number; displayValue?: string }
function StepControl({ label, value, onChange, maximum, displayValue }: StepControlProps) {
 return <Box sx={{ display: "flex", alignItems: "center", flex: "1 1 0", minWidth: 0 }}>
  <DriveButton color="inherit" aria-label={`Decrease ${label.toLowerCase()}`} disabled={value === 0} onClick={() => onChange(Math.max(0, value - 1))}><RemoveRounded /></DriveButton>
  <Box sx={{ textAlign: "center", flex: 1 }}>
   <Typography sx={{ fontSize: 24, color: "text.secondary" }}>{label}</Typography>
   <Typography aria-live="polite" sx={{ fontSize: 32, fontWeight: 800 }}>{displayValue ?? value}</Typography>
  </Box>
  <DriveButton color="inherit" aria-label={`Increase ${label.toLowerCase()}`} disabled={value === maximum} onClick={() => onChange(Math.min(maximum, value + 1))}><AddRounded /></DriveButton>
 </Box>;
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
 // The mini player only earns its row once an account is linked; until then
 // Spotify is reached through the Media button.
 const [musicVisible, setMusicVisible] = useState(spotify.isConnected);
 useEffect(() => { if (spotify.isConnected) setMusicVisible(true); }, [spotify.isConnected]);
 const [temp, setTemp] = useState(5);
 const [fan, setFan] = useState(3);
 const [hazards, setHazards] = useState(false);
 const [rearDemist, setRearDemist] = useState(false);
 const [ac, setAc] = useState(false);
 const [airflow, setAirflow] = useState<"Face" | "Feet" | "Screen">("Face");
 const [error, setError] = useState<string | null>(null);
 const previousVolume = useRef(50);
 const ready = spotify.isConnected && spotify.track !== null;
 useEffect(() => { if (isDriving) { setTab(null); hideKeyboard(); } }, [isDriving, hideKeyboard, setTab]);
 async function mediaAction(action: () => Promise<void>) {
  setError(null);
  try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Playback unavailable. Try again."); }
 }
 const mute = () => mediaAction(async () => {
  const current = duckedFrom.current ?? spotify.volume;
  duckedFrom.current = null;
  if (current > 0) { previousVolume.current = current; await spotify.setVolume(0); }
  else await spotify.setVolume(previousVolume.current || 50);
 });
 return <Box component="footer" data-dock aria-label="Dashboard controls" sx={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20, display: "flex", flexDirection: "column", gap: 1, p: "0 16px 16px", pointerEvents: "none", "& > *": { pointerEvents: "auto" } }}>
  {overlay && <Box sx={{ alignSelf: "flex-end", "&&": { pointerEvents: "none" } }}>{overlay}</Box>}
  {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
  {tab && <Box role="region" id="dashboard-panel" data-map-obstruction aria-label={`${tab} controls`} sx={{ maxHeight: "min(50vh, 760px)", overflowY: "auto", position: "relative", boxShadow: 8, bgcolor: "background.paper", border: "1px solid", borderColor: "divider", borderRadius: 3, p: 2 }}>
   {tab === "media" && <SpotifyPopup spotify={spotify} isDriving={isDriving} />}
   {tab === "climate" && <Box sx={{ display: "grid", gap: 2 }}>
    <Box><Typography sx={{ fontSize: 32, fontWeight: 800 }}>Cabin comfort</Typography><Typography sx={{ fontSize: 22, color: "text.secondary" }}>Preview controls · vehicle not connected</Typography></Box>
    <Box sx={{ display: "flex", gap: 2 }}>
     <DriveButton fullWidth aria-pressed={ac} variant={ac ? "contained" : "outlined"} onClick={() => setAc(!ac)} startIcon={<AcUnitRounded />}>A/C {ac ? "on" : "off"}</DriveButton>
     <DriveButton fullWidth variant="outlined" onClick={() => setAirflow(airflow === "Face" ? "Feet" : airflow === "Feet" ? "Screen" : "Face")}>Airflow: {airflow}</DriveButton>
    </Box>
   </Box>}
  </Box>}
  {musicVisible && tab !== "media" && <Box sx={{ display: "flex", alignItems: "center", bgcolor: "background.paper", border: "1px solid", borderColor: "divider", borderRadius: 3, px: 2, gap: 1, boxShadow: 6 }}>
   {spotify.isConnected ? <>
    {spotify.track?.albumArt && <Box component="img" src={spotify.track.albumArt} alt="" sx={{ width: 80, height: 80, objectFit: "cover", borderRadius: 2, flexShrink: 0 }} />}
    <DriveButton color="inherit" aria-label="Expand music player" onClick={() => { hideKeyboard(); setTab("media"); }} sx={{ flex: 1, minWidth: 0, display: "block", textAlign: "left" }}><Typography noWrap sx={{ fontSize: 28, fontWeight: 700 }}>{spotify.track?.name ?? "Music"}</Typography><Typography noWrap sx={{ fontSize: 22, color: "text.secondary" }}>{spotify.track?.artists ?? "No active playback"}</Typography></DriveButton>
    <DriveButton color="inherit" disabled={!ready} aria-label={spotify.track?.isPlaying ? "Pause music" : "Play music"} onClick={() => mediaAction(spotify.track?.isPlaying ? spotify.pause : spotify.play)}>{spotify.track?.isPlaying ? <PauseRounded /> : <PlayArrowRounded />}</DriveButton>
    <DriveButton color="inherit" disabled={!ready} aria-label="Next track" onClick={() => mediaAction(spotify.next)}><SkipNextRounded /></DriveButton>
    <DriveButton color="inherit" disabled={!ready} aria-label={spotify.volume === 0 ? "Unmute Spotify" : "Mute Spotify"} aria-pressed={spotify.volume === 0} onClick={mute}>{spotify.volume === 0 ? <VolumeOffRounded /> : <VolumeUpRounded />}</DriveButton>
   </> : <DriveButton color="inherit" onClick={() => setTab("media")} sx={{ flex: 1, justifyContent: "flex-start", gap: 1 }}><MusicNoteRounded /> Connect Spotify</DriveButton>}
   <DriveButton color="inherit" aria-label="Collapse music card" onClick={() => setMusicVisible(false)}><ExpandMoreRounded /></DriveButton>
  </Box>}
  <Box sx={{ bgcolor: "background.paper", color: "text.primary", border: "1px solid", borderColor: "divider", borderRadius: 3, p: 1, boxShadow: 5 }}>
  {/* No vehicle link exists yet: say so where the switches are, not only inside the Climate panel. */}
  {!VEHICLE_CONNECTED && <Typography sx={{ fontSize: 18, color: "text.secondary", textAlign: "center", pb: 0.5 }}>Vehicle controls are a preview · not connected to the car</Typography>}
  {/* Same 112 px tall targets as the cards above; width stays narrower so the row fits. */}
  <Box component="nav" aria-label="Dashboard controls" sx={{ display: "flex", alignItems: "center", gap: 0.5, "--car-target": "clamp(76px, 8vw, 88px)", "& .MuiButton-root": { flexShrink: 0, minHeight: "clamp(76px, 10.4vw, 112px)" } }}>
   <DriveButton color={tab === "media" ? "primary" : "inherit"} aria-label="Media" aria-expanded={tab === "media"} aria-controls={tab === "media" ? "dashboard-panel" : undefined} variant={tab === "media" ? "contained" : "text"} onClick={() => { hideKeyboard(); setTab(tab === "media" ? null : "media"); setMusicVisible(true); }}><Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", fontSize: 18 }}><MusicNoteRounded />Media</Box></DriveButton>
   <DriveButton color={tab === "climate" ? "primary" : "inherit"} aria-label="Climate" aria-expanded={tab === "climate"} aria-controls={tab === "climate" ? "dashboard-panel" : undefined} variant={tab === "climate" ? "contained" : "text"} onClick={() => { hideKeyboard(); setTab(tab === "climate" ? null : "climate"); }}><Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", fontSize: 18 }}><AcUnitRounded />Climate</Box></DriveButton>
   <StepControl label="Warmth" value={temp} onChange={setTemp} maximum={10} displayValue={temp === 0 ? "Cool" : temp === 10 ? "Warm" : temp + "/10"} />
   <StepControl label="Fan" value={fan} onChange={setFan} maximum={10} displayValue={fan === 0 ? "Off" : fan + "/10"} />
   <DriveButton color={rearDemist ? "primary" : "inherit"} aria-label="Rear demist (preview)" aria-pressed={rearDemist} onClick={() => setRearDemist(!rearDemist)} variant={rearDemist ? "contained" : "text"} sx={{ flexDirection: "column", fontSize: 20 }}><RearDefrostIcon width={36} height={36} fill="currentColor" />Demist</DriveButton>
   <DriveButton aria-label="Hazard lights (preview)" aria-pressed={hazards} onClick={() => setHazards(!hazards)} color="error" variant={hazards ? "contained" : "outlined"} sx={{ flexDirection: "column", fontSize: 20 }}><WarningAmberRounded />Hazards</DriveButton>
  </Box>
  </Box>
 </Box>;
}
