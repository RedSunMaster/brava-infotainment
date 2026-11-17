import React, { useEffect, useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import DriveButton from "./DriveButton";
import { arrivalStatus, openStatus, parseOpeningHours, weekRows, type OpenState } from "../lib/openingHours";

const COLOURS: Record<OpenState, string> = {
 "open": "success.main",
 "open-24h": "success.main",
 "closing-soon": "warning.main",
 "opening-soon": "warning.main",
 "closed": "error.main",
};

interface Props { hours?: string; showWeek?: boolean; /** Seconds until arrival, to check the hours at that time. */ etaSeconds?: number }
/** Open/closed status for a place, with the full week available when parked. Renders nothing without readable hours. */
export default function OpeningHours({ hours, showWeek = true, etaSeconds }: Props) {
 const week = useMemo(() => parseOpeningHours(hours), [hours]);
 const [now, setNow] = useState(() => new Date());
 const [expanded, setExpanded] = useState(false);
 useEffect(() => {
  if (!week) return;
  const timer = window.setInterval(() => setNow(new Date()), 30000);
  return () => window.clearInterval(timer);
 }, [week]);
 const status = openStatus(week, now);
 const arrival = etaSeconds == null ? null : arrivalStatus(week, now, etaSeconds);
 if (!week || !status) return null;
 return <Box aria-label="Opening hours" sx={{ display: "grid" }}>
  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
   <Box aria-hidden sx={{ width: 14, height: 14, borderRadius: "50%", bgcolor: COLOURS[status.state], flexShrink: 0 }} />
   <Typography sx={{ fontSize: 24, fontWeight: 700, color: COLOURS[status.state], flex: 1, minWidth: 0 }}>{status.label}</Typography>
   {showWeek && <DriveButton color="inherit" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} sx={{ minHeight: 56, fontSize: 22, color: "primary.main" }}>{expanded ? "Hide hours" : "Hours"}</DriveButton>}
  </Box>
  {arrival && <Typography role="status" sx={{ fontSize: 22, fontWeight: 700, color: COLOURS[arrival.state], pl: 3 }}>{arrival.label}</Typography>}
  {showWeek && expanded && <Box component="dl" sx={{ m: 0, mt: 0.5, display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 3, rowGap: 0.5 }}>
   {weekRows(week, now).map(row => <React.Fragment key={row.day}>
    <Typography component="dt" sx={{ fontSize: 22, fontWeight: row.today ? 800 : 400 }}>{row.day}</Typography>
    <Typography component="dd" sx={{ fontSize: 22, m: 0, fontWeight: row.today ? 800 : 400, color: row.today ? "text.primary" : "text.secondary" }}>{row.text}</Typography>
   </React.Fragment>)}
  </Box>}
 </Box>;
}
