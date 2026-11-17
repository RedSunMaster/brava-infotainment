import React from "react";
import { Box } from "@mui/material";
import type { SpeedSignState } from "../lib/speedSigns";

interface Props {
	state: SpeedSignState;
	/** Position is being estimated along the route because GPS has dropped out. */
	estimated?: boolean;
	simulated?: boolean;
}

const RED = "#d32f2f";
const signShadow = "0 4px 14px rgba(0,0,0,0.45)";

function LimitSign({ limit }: { limit: NonNullable<SpeedSignState["limit"]> }) {
	if (limit.kind === "none") {
		// "End of speed limit": pale disc with a diagonal bar.
		return <Box role="img" aria-label="No speed limit" sx={{ width: 128, height: 128, borderRadius: "50%", bgcolor: "#f5f5f5", border: "6px solid #8a8a8a", boxShadow: signShadow, backgroundImage: "linear-gradient(to top left, transparent 45%, #222 45%, #222 55%, transparent 55%)" }} />;
	}
	const digits = String(limit.speed).length;
	return <Box role="img" aria-label={`Speed limit ${limit.speed} ${limit.unit}`} sx={{ width: 128, height: 128, borderRadius: "50%", bgcolor: "#fff", border: `14px solid ${RED}`, boxShadow: signShadow, display: "flex", alignItems: "center", justifyContent: "center", color: "#111", fontWeight: 800, fontSize: digits >= 3 ? 46 : 58, lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: digits >= 3 ? -2 : 0 }}>{limit.speed}</Box>;
}

/**
 * Road-sign style speed read-out: the posted limit as a red-ringed disc, and your own speed
 * as a round sign beside it that turns red when you are over.
 */
export default function SpeedSigns({ state, estimated = false, simulated = false }: Props) {
	const { speed, unit, limit, over } = state;
	return (
		<Box aria-label="Speed" sx={{ display: "flex", alignItems: "flex-end", gap: 1.5 }}>
			<Box role="img" aria-label={`Current speed ${speed} ${unit}${over ? ", over the limit" : ""}${estimated ? ", estimated" : ""}${simulated ? ", simulated" : ""}`}
				sx={{ width: 112, height: 112, borderRadius: "50%", bgcolor: over ? RED : "#16181c", color: "#fff", border: "7px solid #fff", boxShadow: signShadow, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", transition: "background-color 0.25s", lineHeight: 1 }}>
				<Box component="span" sx={{ fontSize: speed >= 100 ? 40 : 48, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{speed}</Box>
				<Box component="span" sx={{ fontSize: 17, fontWeight: 700, opacity: 0.85, mt: 0.4 }}>{estimated ? "est." : simulated ? "sim." : unit}</Box>
			</Box>
			{limit && <LimitSign limit={limit} />}
		</Box>
	);
}
