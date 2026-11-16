import React from "react";
import { Box, Typography } from "@mui/material";
import DriveButton from "./DriveButton";
interface Props { placeName: string; duration: string; distance: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void; disabled?: boolean }
export default function ConfirmNavDialog({ placeName, duration, distance, confirmLabel = "Start", onConfirm, onCancel, disabled = false }: Props) {
 return <Box role="region" aria-label="Route preview" sx={{ bgcolor: "background.paper", borderRadius: 3, p: 2, border: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
  <Box sx={{ flex: "1 1 280px", minWidth: 0 }}><Typography sx={{ fontSize: 32, fontWeight: 800 }}>{placeName}</Typography><Typography sx={{ fontSize: 28, color: "text.secondary" }}>{duration} · {distance}</Typography></Box>
  <DriveButton variant="outlined" onClick={onCancel}>Cancel</DriveButton>
  <DriveButton variant="contained" onClick={onConfirm} disabled={disabled}>{confirmLabel}</DriveButton>
 </Box>;
}

