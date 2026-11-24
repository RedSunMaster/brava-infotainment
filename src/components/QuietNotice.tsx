import React from "react";
import { Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import CloseRounded from "@mui/icons-material/CloseRounded";
import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";

interface Props { children: React.ReactNode; onClose?: () => void; /** Extra buttons, shown before the close button. */ action?: React.ReactNode }
/** A quiet one-line problem notice: a warning icon and the message, in the same flat look as the cards. */
export default function QuietNotice({ children, onClose, action }: Props) {
 return <Box role="status" sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, borderRadius: 3, bgcolor: (theme) => alpha(theme.palette.background.paper, 0.92), border: "1px solid", borderColor: "warning.main" }}>
  <WarningAmberRounded aria-hidden sx={{ color: "warning.main", fontSize: 28, flexShrink: 0 }} />
  <Typography sx={{ flex: 1, minWidth: 0, fontSize: 22 }}>{children}</Typography>
  {action}
  {onClose && <Box component="button" type="button" aria-label="Dismiss" onClick={onClose} sx={{ flexShrink: 0, width: 56, height: 56, border: 0, borderRadius: "50%", bgcolor: "transparent", color: "text.secondary", display: "grid", placeItems: "center", cursor: "pointer", p: 0 }}><CloseRounded /></Box>}
 </Box>;
}
