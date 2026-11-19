import React, { useEffect } from "react";
import { Box, Slider, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import DriveButton from "./DriveButton";
import { useVoiceLevels, voiceLevels } from "../hooks/useMasterVolume";
import type { VoiceLevels } from "../lib/voiceLevels";

const ROWS: { name: keyof VoiceLevels; title: string; hint: string; floor: number }[] = [
	{ name: "guidance", title: "Turn guidance", hint: "Directions such as “In 200 metres, turn left”.", floor: 0.1 },
	{ name: "alerts", title: "Alerts", hint: "Road closures, cameras, faster routes and rerouting.", floor: 0.1 },
	{ name: "messages", title: "Phone messages", hint: "Messages read aloud when you tap Read on a notification.", floor: 0.1 },
	{ name: "music", title: "Music while speaking", hint: "How loud the music stays while a prompt is spoken. 0 silences it.", floor: 0 },
];

/** Sliders that set how loud each spoken prompt is. They sit under the master volume on the music player. */
export default function VoiceVolumes({ onTestGuidance, onTestAlert, onTestMessage }: { onTestGuidance?: () => void; onTestAlert?: () => void; onTestMessage?: () => void }) {
	const { levels, setLevel } = useVoiceLevels();
	// A profile switch remounts this; pick up that driver's saved levels.
	useEffect(() => voiceLevels.reload(), []);
	const test = (name: keyof VoiceLevels) => name === "guidance" ? onTestGuidance : name === "alerts" ? onTestAlert : name === "messages" ? onTestMessage : undefined;
	return <Box sx={{ display: "grid", gap: 2 }}>
		{ROWS.map(({ name, title, hint, floor }) => {
			const run = test(name);
			return <Box key={name} role="group" aria-label={`${title} volume`} sx={{ display: "grid", gap: 0.5 }}>
				<Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
					<Typography sx={{ fontSize: 23, fontWeight: 600, flex: 1 }}>{title}</Typography>
					<Typography aria-hidden sx={{ fontSize: 26, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{Math.round(levels[name] * 100)}%</Typography>
				</Box>
				<Typography sx={{ fontSize: 19, color: "text.secondary" }}>{hint}</Typography>
				<Box sx={{ display: "flex", alignItems: "center", gap: 3, px: 1.5 }}>
					<Slider aria-label={`${title} volume`} value={Math.round(levels[name] * 100)} min={Math.round(floor * 100)} max={100} step={5} onChange={(_, value) => setLevel(name, (value as number) / 100)}
						sx={{ flex: 1, height: 12, py: 3, "& .MuiSlider-thumb": { width: 44, height: 44 }, "& .MuiSlider-rail": { opacity: 0.35 } }} />
					{run && <DriveButton color="inherit" onClick={run} sx={{ minHeight: 64, px: 3, borderRadius: 8, fontSize: 22, fontWeight: 600, bgcolor: (theme) => alpha(theme.palette.text.primary, 0.07) }}>Test</DriveButton>}
				</Box>
			</Box>;
		})}
	</Box>;
}
