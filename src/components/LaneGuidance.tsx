import React from "react";
import { Box } from "@mui/material";
import { describeLanes, INDICATION_ANGLE, laneArrows, laneHighlight, type Lane } from "../lib/laneGuidance";

interface Props { lanes: Lane[]; modifier?: string }

/** Arrow pointing up from a shared base, so a lane that allows two directions reads as a fork. */
function Arrow({ angle, bright }: { angle: number; bright: boolean }) {
	return (
		<Box component="svg" viewBox="0 0 24 24" aria-hidden sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", opacity: bright ? 1 : 0.4 }}>
			<path d="M12 3 L18 10 H13.5 V20 H10.5 V10 H6 Z" fill="currentColor" transform={`rotate(${angle} 12 15)`} />
		</Box>
	);
}

/** Painted-lane style guidance: usable lanes are bright, the arrow to follow is solid. */
export default function LaneGuidance({ lanes, modifier }: Props) {
	return (
		<Box role="img" aria-label={`Lanes: ${describeLanes(lanes, modifier)}`} sx={{ display: "inline-flex", mt: 1, borderRadius: 1.5, overflow: "hidden", border: "1px solid", borderColor: "divider", bgcolor: "action.hover" }}>
			{lanes.map((lane, index) => {
				const highlight = laneHighlight(lane, modifier);
				return (
					<Box key={index} sx={{ position: "relative", width: 56, height: 64, color: lane.valid ? "primary.contrastText" : "text.disabled", bgcolor: lane.valid ? "primary.main" : "transparent", borderLeft: index ? "2px dashed" : "none", borderColor: "divider", boxShadow: lane.active ? "inset 0 -5px 0 rgba(255,255,255,0.8)" : "none" }}>
						<Box sx={{ position: "absolute", inset: "8px 10px" }}>
							{laneArrows(lane).map((indication) => <Arrow key={indication} angle={INDICATION_ANGLE[indication]} bright={lane.valid && indication === highlight} />)}
						</Box>
					</Box>
				);
			})}
		</Box>
	);
}
