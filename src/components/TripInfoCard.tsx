import React, { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";

import type { NormalizedManeuver } from "../lib/routing";
import { remainingTrip } from "../lib/tripMetrics";
import MoreHorizRounded from "@mui/icons-material/MoreHorizRounded";
import MyLocationRounded from "@mui/icons-material/MyLocationRounded";
import VolumeOffRounded from "@mui/icons-material/VolumeOffRounded";
import VolumeUpRounded from "@mui/icons-material/VolumeUpRounded";
import ExploreRounded from "@mui/icons-material/ExploreRounded";
import NavigationRounded from "@mui/icons-material/NavigationRounded";
import DriveButton from "./DriveButton";
interface Props { maneuvers: NormalizedManeuver[]; currentStep: number; distanceToNextM?: number | null; timeToNextS?: number | null; onEndNav: () => void; isDriving: boolean; toolsOpen?: boolean; onToggleTools?: () => void; onLocate?: () => void; muted?: boolean; onToggleMute?: () => void; voiceSupported?: boolean; orientation?: "north" | "heading"; onToggleOrientation?: () => void; /** False while the camera is already following the car. */ canLocate?: boolean }
export default function TripInfoCard({ maneuvers, currentStep, distanceToNextM, timeToNextS, onEndNav, toolsOpen, onToggleTools, onLocate, muted, onToggleMute, voiceSupported = true, orientation, onToggleOrientation, canLocate = true }: Props) {
 const [confirmEnd, setConfirmEnd] = useState(false);
 const confirmOpenedAt = useRef(0);
 const [now, setNow] = useState(Date.now);
 useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);
 // The confirmation replaces the card contents in place, so the turn instruction
 // stays visible. It dismisses itself if left alone.
 useEffect(() => {
  if (!confirmEnd) return;
  const timer = window.setTimeout(() => setConfirmEnd(false), 8000);
  return () => window.clearTimeout(timer);
 }, [confirmEnd]);
 const { km, seconds } = remainingTrip(maneuvers, currentStep, distanceToNextM, timeToNextS);
 // Same format as the status-bar clock.
 const eta = new Date(now + seconds * 1000).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
 const cardSx = { bgcolor: "background.paper", borderRadius: 3, border: "1px solid", borderColor: "divider", px: 2, display: "flex", alignItems: "center", gap: 1, minHeight: "calc(var(--car-target, 112px) + 2px)" };
 if (confirmEnd) return <Box role="alertdialog" aria-labelledby="end-navigation-title" sx={cardSx}>
  <Typography id="end-navigation-title" sx={{ flex: 1, fontSize: 34, fontWeight: 800 }}>End navigation?</Typography>
  <DriveButton autoFocus variant="outlined" onClick={() => setConfirmEnd(false)} sx={{ px: 3 }}>Keep route</DriveButton>
  {/* Ignores the tail of a double-tap on End so one touch cannot end the route. */}
  <DriveButton color="error" variant="contained" onClick={() => { if (Date.now() - confirmOpenedAt.current > 500) onEndNav(); }} sx={{ px: 3 }}>End route</DriveButton>
 </Box>;
 return <Box sx={cardSx}>
  <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontSize: 34, fontWeight: 800 }}>{eta}</Typography><Typography sx={{ fontSize: 26, color: "text.secondary" }}>{Math.ceil(seconds / 60)} min · {km >= 1 ? km.toFixed(1) + " km" : Math.round(km * 1000) + " m"}</Typography></Box>
  {onToggleMute && <DriveButton color={muted ? "error" : "inherit"} aria-label={muted ? "Unmute navigation" : "Mute navigation"} aria-pressed={muted} disabled={!voiceSupported} onClick={onToggleMute}>{muted ? <VolumeOffRounded /> : <VolumeUpRounded />}</DriveButton>}
  {/* Shows the current mode: an arrow for heading-up, a compass for north-up. */}
  {onToggleOrientation && <DriveButton color="inherit" aria-label={orientation === "heading" ? "Switch to north up" : "Switch to heading up"} onClick={onToggleOrientation}>{orientation === "heading" ? <NavigationRounded /> : <ExploreRounded />}</DriveButton>}
  {onLocate && <DriveButton color="inherit" aria-label="Centre on location" disabled={!canLocate} onClick={onLocate}><MyLocationRounded /></DriveButton>}
  {onToggleTools && <DriveButton color="inherit" variant={toolsOpen ? "contained" : "text"} aria-label="Navigation options" aria-expanded={toolsOpen} aria-controls={toolsOpen ? "navigation-options" : undefined} onClick={onToggleTools}><MoreHorizRounded /></DriveButton>}
  <DriveButton variant="outlined" aria-label="End navigation" onClick={() => { confirmOpenedAt.current = Date.now(); setConfirmEnd(true); }}>End</DriveButton>
 </Box>;
}
