import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import DriveButton from "./DriveButton";
import { Stat } from "./ExplorePanel";
import type { PacmanStats, SoundSetting } from "../hooks/usePacman";
import { REGROW_OPTIONS, type Regrow } from "../lib/pacman";

interface Props {
	stats: PacmanStats | null;
	regrow: Regrow;
	onRegrowChange: (value: Regrow) => void;
	ghosts: boolean;
	onGhostsChange: (value: boolean) => void;
	sound: SoundSetting;
	onSoundChange: (value: SoundSetting) => void;
	onReset: () => void;
	isDriving: boolean;
	/** Whether Pac-Man is the mode being played now. */
	playing: boolean;
}

const count = (value: number) => value.toLocaleString("en-NZ");

/** Pac-Man's stats and options in Settings → Game Modes. */
export default function PacmanPanel({ stats, regrow, onRegrowChange, ghosts, onGhostsChange, sound, onSoundChange, onReset, isDriving, playing }: Props) {
	const [confirming, setConfirming] = useState(false);
	useEffect(() => { if (!confirming) return; const timer = window.setTimeout(() => setConfirming(false), 5000); return () => window.clearTimeout(timer); }, [confirming]);
	const since = stats ? new Date(stats.startedAt).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" }) : "";
	return (
		<>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Box>
					<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Your score</Typography>
					<Typography sx={{ fontSize: 20, color: "text.secondary" }}>
						{stats ? `Since ${since}.` : "Loading…"}{!playing && " Choose Pac-Man above to play."}
					</Typography>
				</Box>
				{stats && (
					<Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 1 }}>
						<Stat label="Score" value={count(stats.score)} />
						<Stat label="Dots eaten" value={count(stats.dots)} />
						<Stat label="Power pellets" value={count(stats.pellets)} />
						<Stat label="Current run" value={`${count(stats.streak)}${stats.streak ? ` · ${stats.multiplier}×` : ""}`} />
						<Stat label="Best run" value={count(stats.bestStreak)} />
						<Stat label="Dots today" value={count(stats.today)} />
						<Stat label="Best day" value={count(stats.bestDay)} />
						<Stat label="Caught by ghost" value={count(stats.caught)} />
						<Stat label="Ghosts eaten" value={count(stats.ghostsEaten)} />
						{playing && <Stat label="Dots within 1 km" value={stats.nearby === null ? (stats.loading ? "Loading…" : "—") : count(stats.nearby)} />}
					</Box>
				)}
			</Box>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Box>
					<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Dots grow back</Typography>
					<Typography sx={{ fontSize: 20, color: "text.secondary" }}>
						How long after being eaten a dot comes back. Shorter keeps your regular roads worth driving; Never makes every dot a one-off.
					</Typography>
				</Box>
				<Box role="group" aria-label="Dots grow back" sx={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 1 }}>
					{REGROW_OPTIONS.map(([value, text]) => <DriveButton key={value} className="settings-option" variant={regrow === value ? "contained" : "outlined"} aria-pressed={regrow === value} onClick={() => onRegrowChange(value)}>{text}</DriveButton>)}
				</Box>
			</Box>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Box>
					<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Ghost</Typography>
					<Typography sx={{ fontSize: 20, color: "text.secondary" }}>
						Four ghosts chase you along the roads at your own speed, so driving faster never helps, and they all stand still whenever you are stopped. Blinky follows you, Pinky heads you off, Inky comes at you from the side and Clyde chases until he is close. They come out one after another, a little way off. If one catches you, your run ends and you lose 50 points. A power pellet turns them all blue for 15 seconds, and while they are blue you can eat them: 200, 400, 800 then 1,600 points.
					</Typography>
				</Box>
				<Box role="group" aria-label="Ghost" sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
					{([[true, "On"], [false, "Off"]] as const).map(([value, text]) => <DriveButton key={text} className="settings-option" variant={ghosts === value ? "contained" : "outlined"} aria-pressed={ghosts === value} onClick={() => onGhostsChange(value)}>{text}</DriveButton>)}
				</Box>
			</Box>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Box>
					<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Sound effects</Typography>
					<Typography sx={{ fontSize: 20, color: "text.secondary" }}>
						The arcade's own sounds: the start tune, waka, power pellets, the ghosts' siren, eating a ghost and being caught. They follow the master volume.
					</Typography>
				</Box>
				<Box role="group" aria-label="Sound effects" sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>
					{([["off", "Off"], ["quiet", "Quiet"], ["normal", "Normal"]] as const).map(([value, text]) => <DriveButton key={value} className="settings-option" variant={sound === value ? "contained" : "outlined"} aria-pressed={sound === value} onClick={() => onSoundChange(value)}>{text}</DriveButton>)}
				</Box>
			</Box>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Box>
					<Typography sx={{ fontSize: 25, fontWeight: 700 }}>How it works</Typography>
					<Typography sx={{ fontSize: 20, color: "text.secondary" }}>
						Each dot is 10 points, and a big dot is 50. A run of dots builds a multiplier (one more for every 50, up to 5×), and the run ends if 45 seconds pass without one. Points are for dots and ghosts, never speed. Roads come from OpenStreetMap and are saved once seen, so they work offline afterwards.
					</Typography>
				</Box>
			</Box>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Box>
					<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Start again</Typography>
					<Typography sx={{ fontSize: 20, color: "text.secondary" }}>Clears this profile's score, stats and eaten dots. Only while parked.</Typography>
				</Box>
				<DriveButton className="settings-option" color="error" variant={confirming ? "contained" : "outlined"} disabled={isDriving || !stats}
					onClick={() => { if (confirming) { onReset(); setConfirming(false); } else setConfirming(true); }}>
					{confirming ? "Tap again to clear everything" : "Clear Pac-Man score"}
				</DriveButton>
			</Box>
		</>
	);
}
