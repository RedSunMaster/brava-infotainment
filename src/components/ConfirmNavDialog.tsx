import React from "react";
import { Box, Typography } from "@mui/material";
import DriveButton from "./DriveButton";
import OpeningHours from "./OpeningHours";
import type { PlaceDetails } from "../lib/locationSearch";
interface Props { position: [number, number]; placeName: string; duration: string; distance: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void; disabled?: boolean; choices?: { duration: string; distance: string }[]; selected?: number; onChoose?: (index: number) => void; details?: PlaceDetails; isDriving?: boolean; detour?: string; etaSeconds?: number }
export default function ConfirmNavDialog({ position, placeName, duration, distance, confirmLabel = "Start", onConfirm, onCancel, disabled = false, choices, selected, onChoose, details, isDriving = false, detour, etaSeconds }: Props) {
 return <Box role="region" aria-label="Route preview" sx={{ bgcolor: "background.paper", borderRadius: 3, p: 2, border: "1px solid", borderColor: "divider", display: "grid", gap: 1 }}>
  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><Box sx={{ flex: 1, minWidth: 0 }}><Typography noWrap sx={{ fontSize: 32, fontWeight: 800 }}>{placeName.split(",")[0]}</Typography><Typography noWrap sx={{ fontSize: 22, color: "text.secondary" }}>{detour && <Box component="span" sx={{ fontWeight: 800, color: "text.primary" }}>{detour} · </Box>}{duration} · {distance}</Typography></Box><DriveButton variant="outlined" onClick={onCancel}>Cancel</DriveButton><DriveButton variant="contained" onClick={onConfirm} disabled={disabled}>{confirmLabel}</DriveButton></Box>

  {choices && choices.length > 1 && <Box role="group" aria-label="Alternative routes" sx={{ display: "flex", gap: 1 }}>{choices.map((choice, index) => <DriveButton key={index} disabled={disabled} aria-pressed={selected === index} variant={selected === index ? "contained" : "outlined"} sx={{ flex: 1, minWidth: 0, px: 1, fontSize: 22 }} onClick={() => onChoose?.(index)}>{choice.duration} · {choice.distance}</DriveButton>)}</Box>}
  <OpeningHours key={`${placeName}-${position.join(",")}`} hours={details?.hours} showWeek={!isDriving} etaSeconds={etaSeconds} />
 </Box>;
}

