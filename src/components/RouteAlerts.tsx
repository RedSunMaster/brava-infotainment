import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import ConstructionRounded from "@mui/icons-material/ConstructionRounded";
import BlockRounded from "@mui/icons-material/BlockRounded";
import TrafficRounded from "@mui/icons-material/TrafficRounded";
import CloudOffRounded from "@mui/icons-material/CloudOffRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import DriveButton from "./DriveButton";
import type { AlertKind, RouteAlert } from "../lib/routeAlerts";

const ICONS: Record<AlertKind, React.ElementType> = { closure: BlockRounded, incident: ConstructionRounded, delay: TrafficRounded, stale: CloudOffRounded };
const COLOURS = { error: "error.main", warning: "warning.main", info: "text.secondary" } as const;

/** Compact route warnings: one line each, colour-coded, dismissible until something new appears. */
export default function RouteAlerts({ alerts }: { alerts: RouteAlert[] }) {
 const signature = alerts.map(alert => alert.id).join("|");
 const [dismissed, setDismissed] = useState<string | null>(null);
 useEffect(() => { if (dismissed !== null && dismissed !== signature) setDismissed(null); }, [signature, dismissed]);
 if (!alerts.length || dismissed === signature) return null;
 return <Box role="alert" aria-label="Route warnings" sx={{ bgcolor: "background.paper", border: "1px solid", borderColor: "divider", borderRadius: 3, display: "flex", alignItems: "center", gap: 0.5, pl: 1.5, pr: 0.5, py: 0.5 }}>
  <Box sx={{ flex: 1, minWidth: 0, display: "grid" }}>
   {alerts.map(alert => {
    const Icon = ICONS[alert.kind];
    return <Box key={alert.id} sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: 44, minWidth: 0 }}>
     <Icon aria-hidden sx={{ fontSize: 28, color: COLOURS[alert.severity], flexShrink: 0 }} />
     <Typography noWrap sx={{ fontSize: 22, fontWeight: 700, minWidth: 0 }}>{alert.title}</Typography>
     {alert.detail && <Typography noWrap sx={{ fontSize: 20, color: "text.secondary", flexShrink: 0, maxWidth: "45%" }}>{alert.detail}</Typography>}
    </Box>;
   })}
  </Box>
  <DriveButton color="inherit" aria-label="Dismiss route warnings" onClick={() => setDismissed(signature)} sx={{ minWidth: 56, minHeight: 56, p: 0 }}><CloseRounded /></DriveButton>
 </Box>;
}
