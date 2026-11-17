import React from "react";
import { Box, Typography } from "@mui/material";
import AltRouteRounded from "@mui/icons-material/AltRouteRounded";
import DriveButton from "./DriveButton";
import { describeSaving } from "../lib/fasterRoute";

interface Props { savedSeconds: number; arrival: string; onSwitch: () => void; onKeep: () => void; disabled?: boolean }
/** A quicker route is available: say how much quicker, when you would arrive, and let the driver choose. */
export default function FasterRouteOffer({ savedSeconds, arrival, onSwitch, onKeep, disabled = false }: Props) {
 return <Box role="alert" aria-label="Faster route available" sx={{ bgcolor: "background.paper", border: "1px solid", borderColor: "success.main", borderRadius: 3, display: "flex", alignItems: "center", gap: 1, p: 1 }}>
  <AltRouteRounded aria-hidden sx={{ fontSize: 36, color: "success.main", flexShrink: 0, ml: 0.5 }} />
  <Box sx={{ flex: 1, minWidth: 0 }}>
   <Typography noWrap sx={{ fontSize: 24, fontWeight: 800 }}>Faster route · {describeSaving(savedSeconds)}</Typography>
   <Typography noWrap sx={{ fontSize: 20, color: "text.secondary" }}>Arrive {arrival}</Typography>
  </Box>
  <DriveButton variant="outlined" onClick={onKeep} sx={{ minWidth: 0, px: 2 }}>Keep</DriveButton>
  <DriveButton variant="contained" onClick={onSwitch} disabled={disabled} sx={{ minWidth: 0, px: 2 }}>Switch</DriveButton>
 </Box>;
}
