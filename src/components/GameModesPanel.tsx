import React, { useState } from "react";
import { Box, Typography } from "@mui/material";
import BlockRounded from "@mui/icons-material/BlockRounded";
import BlurOnRounded from "@mui/icons-material/BlurOnRounded";
import SportsEsportsRounded from "@mui/icons-material/SportsEsportsRounded";
import DriveButton from "./DriveButton";
import { GAME_MODES, type GameMode } from "../lib/gameModes";

const ICONS: Record<GameMode, React.ReactNode> = { off: <BlockRounded />, fog: <BlurOnRounded />, pacman: <SportsEsportsRounded /> };

interface Props {
	mode: GameMode;
	onModeChange: (mode: GameMode) => void;
	/** Stats and options for each mode that has them. */
	panels: Partial<Record<GameMode, React.ReactNode>>;
}

/**
 * Settings → Game Modes: pick the mode to play (one at a time), and look at each mode's stats. Choosing a mode and looking
 * at one are separate, so a mode's stats can be seen without switching to it.
 */
export default function GameModesPanel({ mode, onModeChange, panels }: Props) {
	const withStats = GAME_MODES.filter(item => panels[item.id]);
	const [viewing, setViewing] = useState<GameMode>(panels[mode] ? mode : withStats[0]?.id ?? "off");
	const current = GAME_MODES.find(item => item.id === mode)!;
	const shown = GAME_MODES.find(item => item.id === viewing);
	return (
		<>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Box>
					<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Game mode</Typography>
					<Typography sx={{ fontSize: 20, color: "text.secondary" }}>{current.description}</Typography>
				</Box>
				<Box role="group" aria-label="Game mode" sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 1 }}>
					{GAME_MODES.map(item => (
						<DriveButton key={item.id} className="settings-option" variant={mode === item.id ? "contained" : "outlined"} aria-pressed={mode === item.id}
							onClick={() => { onModeChange(item.id); if (panels[item.id]) setViewing(item.id); }}
							sx={{ flexDirection: "column", gap: 0.5, py: 1.25, lineHeight: 1.1, "& .MuiSvgIcon-root": { fontSize: "clamp(30px, 3.4vw, 40px)" } }}>
							{ICONS[item.id]}
							<span>{item.name}</span>
							<Box component="span" sx={{ fontSize: "clamp(15px, 1.7vw, 19px)", fontWeight: 400, opacity: 0.8 }}>{item.tagline}</Box>
						</DriveButton>
					))}
				</Box>
			</Box>
			{withStats.length > 1 && (
				<Box role="tablist" aria-label="Stats for" sx={{ display: "grid", gridTemplateColumns: `repeat(${withStats.length}, minmax(0, 1fr))`, gap: 1 }}>
					{withStats.map(item => (
						<DriveButton key={item.id} role="tab" aria-selected={viewing === item.id} className="settings-option" color="inherit" variant={viewing === item.id ? "contained" : "text"} onClick={() => setViewing(item.id)}>
							{item.name}{mode === item.id ? " · playing" : ""}
						</DriveButton>
					))}
				</Box>
			)}
			{shown && panels[shown.id]}
		</>
	);
}
