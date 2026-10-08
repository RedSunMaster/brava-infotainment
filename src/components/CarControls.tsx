import React, { useEffect, useRef, useState } from "react";
import { Alert, Box, Typography } from "@mui/material";
import { AddRounded, RemoveRounded, PauseRounded, PlayArrowRounded, SkipNextRounded, WarningAmberRounded, CloseRounded, VolumeOffRounded, VolumeUpRounded, AcUnitRounded } from "@mui/icons-material";
import DriveButton from "./DriveButton";
import SpotifyPopup from "./SpotifyPopup";
import { useSpotify } from "../hooks/useSpotify";
import RearDefrostIcon from "../../public/icons/rearWindshieldDefrost.svg";
import FanOnIcon from "../../public/icons/fanOn.svg";

interface Props { isDriving: boolean; children: React.ReactNode }
interface StepControlProps { label: string; value: number; onChange: (value: number) => void; maximum: number; displayValue?: string }
function StepControl({ label, value, onChange, maximum, displayValue }: StepControlProps) {
 return <Box sx={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
  <DriveButton aria-label={`Decrease ${label.toLowerCase()}`} disabled={value === 0} onClick={() => onChange(Math.max(0, value - 1))}><RemoveRounded /></DriveButton>
  <Box sx={{ textAlign: "center", flex: 1, minWidth: 58 }}>
   <Typography sx={{ fontSize: "clamp(18px, 2.4vw, 26px)", color: "text.secondary" }}>{label}</Typography>
   <Typography aria-live="polite" sx={{ fontSize: "clamp(24px, 3.2vw, 36px)", fontWeight: 800 }}>{displayValue ?? value}</Typography>
  </Box>
  <DriveButton aria-label={`Increase ${label.toLowerCase()}`} disabled={value === maximum} onClick={() => onChange(Math.min(maximum, value + 1))}><AddRounded /></DriveButton>
 </Box>;
}
export default function CarControls({ isDriving, children }: Props) {
 const spotify = useSpotify();
 const [mediaOpen, setMediaOpen] = useState(false);
 const [vehicleOpen, setVehicleOpen] = useState(false);
 const mediaAnchor = useRef<HTMLDivElement>(null);
 const [temp, setTemp] = useState(5);
 const [fan, setFan] = useState(3);
 const [hazards, setHazards] = useState(false);
 const [rearDemist, setRearDemist] = useState(false);
 const [ac, setAc] = useState(false);
 const [airflow, setAirflow] = useState<"Face" | "Feet" | "Screen">("Face");
 const [error, setError] = useState<string | null>(null);
 const previousVolume = useRef(50);
 const ready = spotify.isConnected && spotify.track !== null;
 useEffect(() => { if (isDriving) { setVehicleOpen(false); setMediaOpen(false); } }, [isDriving]);
 async function mediaAction(action: () => Promise<void>) {
  setError(null);
  try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Playback unavailable. Try again."); }
 }
 const mute = () => mediaAction(async () => {
  if (spotify.volume > 0) { previousVolume.current = spotify.volume; await spotify.setVolume(0); }
  else await spotify.setVolume(previousVolume.current || 50);
 });
 return <Box component="footer" aria-label="Dashboard controls" sx={{ flexShrink: 0, position: "relative", zIndex: 10000, bgcolor: "background.default", p: "12px", display: "grid", gap: "8px" }}>
  {error && <Alert severity="error" onClose={() => setError(null)} sx={{ position: "absolute", bottom: "100%", left: 12, right: 12, fontSize: 24 }}>{error}</Alert>}
  {vehicleOpen && <Box role="region" aria-label="Vehicle settings" sx={{ position: "absolute", bottom: "100%", left: 12, right: 12, bgcolor: "background.paper", p: 2, borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
   <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}><Typography sx={{ fontSize: 30, fontWeight: 800 }}>Climate</Typography><DriveButton aria-label="Close climate panel" onClick={() => setVehicleOpen(false)}><CloseRounded /></DriveButton></Box>
   <Box sx={{ display: "flex", gap: 2 }}>
    <DriveButton fullWidth aria-pressed={ac} variant={ac ? "contained" : "outlined"} onClick={() => setAc(!ac)} startIcon={<AcUnitRounded />}>A/C {ac ? "on" : "off"}</DriveButton>
    <DriveButton fullWidth onClick={() => setAirflow(airflow === "Face" ? "Feet" : airflow === "Feet" ? "Screen" : "Face")}>Airflow: {airflow}</DriveButton>
   </Box>
  </Box>}
  <Box ref={mediaAnchor} sx={{ display: "flex", gap: 1, alignItems: "center", borderBottom: "1px solid", borderColor: "divider", pb: 1 }}>
   <DriveButton aria-label="Open music" aria-expanded={mediaOpen} onClick={() => { setVehicleOpen(false); setMediaOpen(!mediaOpen); }} sx={{ minWidth: 0, flex: 1, justifyContent: "flex-start", textAlign: "left", px: 2 }}>
    <Box sx={{ minWidth: 0 }}><Typography noWrap sx={{ fontSize: "clamp(22px, 2.8vw, 30px)", fontWeight: 800 }}>{spotify.track?.name ?? "Music"}</Typography><Typography noWrap sx={{ fontSize: "clamp(18px, 2.2vw, 24px)", color: "text.secondary" }}>{spotify.track?.artists ?? (spotify.isConnected ? "No active playback" : "Connect Spotify")}</Typography></Box>
   </DriveButton>
   <DriveButton disabled={!ready} aria-label={spotify.track?.isPlaying ? "Pause music" : "Play music"} onClick={() => mediaAction(spotify.track?.isPlaying ? spotify.pause : spotify.play)}>{spotify.track?.isPlaying ? <PauseRounded /> : <PlayArrowRounded />}</DriveButton>
   <DriveButton disabled={!ready} aria-label="Next track" onClick={() => mediaAction(spotify.next)}><SkipNextRounded /></DriveButton>
   <DriveButton disabled={!ready} aria-label={spotify.volume === 0 ? "Unmute Spotify" : "Mute Spotify"} aria-pressed={spotify.volume === 0} onClick={mute}>{spotify.volume === 0 ? <VolumeOffRounded /> : <VolumeUpRounded />}</DriveButton>
  </Box>
  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
   <StepControl label="Warmth" value={temp} onChange={setTemp} maximum={10} displayValue={temp === 0 ? "Cool" : temp === 10 ? "Warm" : `${temp}/10`} />
   <StepControl label="Fan" value={fan} onChange={setFan} maximum={10} displayValue={fan === 0 ? "Off" : `${fan}/10`} />
   <DriveButton aria-label="Rear demist" aria-pressed={rearDemist} onClick={() => setRearDemist(!rearDemist)} variant={rearDemist ? "contained" : "text"} sx={{ flexDirection: "column", fontSize: "clamp(16px, 2vw, 22px)" }}><RearDefrostIcon width={40} height={40} fill="currentColor" />Rear demist</DriveButton>
   <DriveButton aria-label="Hazard lights" aria-pressed={hazards} onClick={() => setHazards(!hazards)} color="error" variant={hazards ? "contained" : "outlined"} sx={{ flexDirection: "column", fontSize: "clamp(16px, 2vw, 22px)" }}><WarningAmberRounded />Hazards</DriveButton>
  </Box>
  <Box component="nav" aria-label="Navigation actions" sx={{ display: "flex", alignItems: "center", gap: 1 }}>{children}<DriveButton aria-label="Open climate controls" aria-expanded={vehicleOpen} onClick={() => { setMediaOpen(false); setVehicleOpen(!vehicleOpen); }} sx={{ flexDirection: "column", fontSize: "clamp(16px, 2vw, 22px)" }}><FanOnIcon width={36} height={36} fill="currentColor" />Climate</DriveButton></Box>
  <SpotifyPopup anchorEl={mediaOpen ? mediaAnchor.current : null} onClose={() => setMediaOpen(false)} spotify={spotify} isDriving={isDriving} />
 </Box>;
}

