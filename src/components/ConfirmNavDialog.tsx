import React from "react";
import { Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import DriveButton from "./DriveButton";
import OpeningHours from "./OpeningHours";
import type { PlaceDetails } from "../lib/locationSearch";
interface Props { position: [number, number]; placeName: string; duration: string; distance: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void; disabled?: boolean; choices?: { duration: string; distance: string; seconds?: number; km?: number }[]; selected?: number; onChoose?: (index: number) => void; details?: PlaceDetails; isDriving?: boolean; detour?: string; etaSeconds?: number }
export default function ConfirmNavDialog({ position, placeName, duration, distance, confirmLabel = "Go", onConfirm, onCancel, disabled = false, choices, selected, onChoose, details, isDriving = false, detour, etaSeconds }: Props) {
 const several = choices !== undefined && choices.length > 1;
 // What each route is best at, so the choice is not just two similar numbers.
 const fastest = several ? Math.min(...choices.map((c) => c.seconds ?? Infinity)) : undefined;
 const shortest = several ? Math.min(...choices.map((c) => c.km ?? Infinity)) : undefined;
 const arrival = etaSeconds === undefined || detour ? null : new Date(Date.now() + etaSeconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
 const summary = arrival ? (several ? `Arrive ${arrival}` : `Arrive ${arrival} · ${duration} · ${distance}`) : `${duration} · ${distance}`;
 return <Box role="region" aria-label="Route preview" sx={{ bgcolor: (theme) => alpha(theme.palette.background.paper, 0.92), borderRadius: 3, p: 2, border: "1px solid", borderColor: "divider", boxShadow: 6, display: "grid", gap: 1.5 }}>
  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
   <Box sx={{ flex: 1, minWidth: 0 }}>
    <Typography noWrap sx={{ fontSize: 30, fontWeight: 700, lineHeight: 1.2 }}>{placeName.split(",")[0]}</Typography>
    <Typography noWrap sx={{ fontSize: 24, fontWeight: 600, color: "text.secondary" }}>{detour && <Box component="span" sx={{ fontWeight: 700, color: "text.primary" }}>{detour} · </Box>}{summary}</Typography>
   </Box>
   <DriveButton color="inherit" onClick={onCancel} sx={{ minWidth: 0, minHeight: 64, px: 3, borderRadius: 8, fontSize: 22, fontWeight: 600, color: "text.primary", bgcolor: (theme) => alpha(theme.palette.text.primary, 0.07), "&:hover": { bgcolor: (theme) => alpha(theme.palette.text.primary, 0.07) } }}>Cancel</DriveButton>
   <DriveButton variant="contained" color="success" onClick={onConfirm} disabled={disabled} sx={{ minWidth: 0, minHeight: 64, px: 5, borderRadius: 8, fontSize: 26, fontWeight: 800 }}>{confirmLabel}</DriveButton>
  </Box>
  {several && <Box role="group" aria-label="Alternative routes" sx={{ display: "flex", gap: 1, width: "100%" }}>{choices.map((choice, index) => {
   const on = selected === index;
   const slower = choice.seconds !== undefined && fastest !== undefined ? Math.round((choice.seconds - fastest) / 60) : 0;
   const label = (choice.seconds === fastest ? "Fastest" : choice.km === shortest ? "Shortest" : "Slower") + (slower > 0 ? ` · +${slower} min` : "");
   return <DriveButton key={index} color="inherit" disabled={disabled} aria-pressed={on} onClick={() => onChoose?.(index)}
    sx={{ flex: "1 1 0", minWidth: 0, whiteSpace: "nowrap", minHeight: 84, px: 2.5, py: 1, borderRadius: 3, justifyContent: "flex-start", textAlign: "left", display: "grid", gap: 0, alignContent: "center",
     color: on ? "primary.main" : "text.secondary",
     bgcolor: on ? (theme) => alpha(theme.palette.primary.main, 0.12) : "transparent",
     border: "1.5px solid", borderColor: on ? "primary.main" : "divider",
     "&:hover": { bgcolor: on ? (theme) => alpha(theme.palette.primary.main, 0.12) : "transparent" } }}>
    <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 19, fontWeight: 600 }}>
     <Box component="span" aria-hidden sx={{ width: 22, height: 5, borderRadius: 3, bgcolor: on ? "primary.main" : "text.disabled" }} />{label}
    </Box>
    <Box component="span" sx={{ fontSize: 26, fontWeight: 700, color: on ? "text.primary" : "text.secondary" }}>{choice.duration}<Box component="span" sx={{ fontWeight: 500, color: "text.secondary" }}> · {choice.distance}</Box></Box>
   </DriveButton>;
  })}</Box>}
  <OpeningHours key={`${placeName}-${position.join(",")}`} hours={details?.hours} showWeek={!isDriving} etaSeconds={etaSeconds} />
 </Box>;
}

