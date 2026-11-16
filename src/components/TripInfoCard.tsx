import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { CloseRounded } from "@mui/icons-material";
import type { NormalizedManeuver } from "../lib/routing";
import { remainingTrip } from "../lib/tripMetrics";
import DriveButton from "./DriveButton";
interface Props { maneuvers: NormalizedManeuver[]; currentStep: number; distanceToNextM?: number | null; timeToNextS?: number | null; onEndNav: () => void; isDriving: boolean }
export default function TripInfoCard({ maneuvers, currentStep, distanceToNextM, timeToNextS, onEndNav }: Props) {
 const [confirmEnd, setConfirmEnd] = useState(false);
 const [now, setNow] = useState(Date.now);
 useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);
 const { km, seconds } = remainingTrip(maneuvers, currentStep, distanceToNextM, timeToNextS);
 const eta = new Date(now + seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
 return <Box sx={{ bgcolor: "background.paper", borderRadius: 3, border: "1px solid", borderColor: "divider", px: 2, display: "flex", alignItems: "center", gap: 2 }}>
  {confirmEnd ? <>
   <Typography sx={{ flex: 1, fontSize: 30, fontWeight: 700 }}>End this route?</Typography>
   <DriveButton onClick={() => setConfirmEnd(false)}>Keep route</DriveButton>
   <DriveButton color="error" variant="contained" onClick={onEndNav}>End route</DriveButton>
  </> : <>
   <Box sx={{ flex: 1 }}><Typography sx={{ fontSize: 34, fontWeight: 800 }}>{eta}</Typography><Typography sx={{ fontSize: 26, color: "text.secondary" }}>{Math.ceil(seconds / 60)} min · {km >= 1 ? km.toFixed(1) + " km" : Math.round(km * 1000) + " m"}</Typography></Box>
   <DriveButton aria-label="End navigation" onClick={() => setConfirmEnd(true)}><CloseRounded /></DriveButton>
  </>}
 </Box>;
}

