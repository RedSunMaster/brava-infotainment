import React, { useEffect, useRef, useState } from "react";
import { Box, Popover, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import ChevronLeftRounded from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import VolumeUpRounded from "@mui/icons-material/VolumeUpRounded";
import DriveButton from "./DriveButton";
import { useMasterVolume } from "../hooks/useMasterVolume";

/** Steps the master volume moves by from the chevrons and the meter. */
export const VOLUME_STEP = 5;
/** How long the pop-up stays open after the last touch. */
const IDLE_CLOSE_MS = 4000;
const BARS = 100 / VOLUME_STEP;

/** The same flat chevron cells as the dock's steppers. */
const CHEVRON = { flex: "0 0 72px", minWidth: 0, minHeight: 96, borderRadius: 0, color: "text.secondary", "&:hover": { bgcolor: "action.hover", color: "text.primary" }, "& .MuiSvgIcon-root": { fontSize: 40 } } as const;

/**
 * The level as a row of bars that grow taller, like the dock's fan meter: lit up to the current volume. The whole height of the row
 * is the touch target, and it can be tapped or dragged to set the level.
 */
function VolumeMeter({ level, onChange }: { level: number; onChange: (level: number) => void }) {
	const set = (event: React.PointerEvent<HTMLElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		if (rect.width <= 0) return;
		const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
		const next = Math.round((fraction * 100) / VOLUME_STEP) * VOLUME_STEP;
		if (next !== level) onChange(next);
	};
	const lit = Math.round(level / VOLUME_STEP);
	return <Box role="slider" tabIndex={0} aria-label="Volume" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level} aria-valuetext={`${level}%`}
		onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); set(event); }}
		onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) set(event); }}
		onKeyDown={(event) => {
			if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); onChange(Math.min(100, level + VOLUME_STEP)); }
			else if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); onChange(Math.max(0, level - VOLUME_STEP)); }
		}}
		sx={{ flex: 1, minWidth: 0, alignSelf: "stretch", display: "flex", alignItems: "flex-end", gap: "4px", py: 2.5, cursor: "pointer", touchAction: "none", "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: -3, borderRadius: 2 } }}>
		{Array.from({ length: BARS }, (_, index) => <Box key={index} aria-hidden sx={{ flex: 1, height: `${25 + index * (75 / (BARS - 1))}%`, borderRadius: "3px", bgcolor: index < lit ? "primary.main" : "text.disabled", opacity: index < lit ? 1 : 0.45 }} />)}
	</Box>;
}

/** ‹ speaker and number, then the bars › : the dock's stepper with a meter you can drag. */
export function VolumeSlider({ onTouch }: { onTouch?: () => void }) {
	const { level, setLevel } = useMasterVolume();
	const change = (next: number) => { onTouch?.(); setLevel(Math.min(100, Math.max(0, next))); };
	return <Box role="group" aria-label={`Volume ${level}%`} sx={{ display: "flex", alignItems: "stretch", width: "100%", minHeight: 96 }}>
		<DriveButton color="inherit" aria-label="Quieter" disabled={level <= 0} onClick={() => change(Math.ceil(level / VOLUME_STEP) * VOLUME_STEP - VOLUME_STEP)} sx={CHEVRON}><ChevronLeftRounded /></DriveButton>
		<Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, flexShrink: 0 }}>
			<VolumeUpRounded aria-hidden sx={{ fontSize: 30, color: "text.secondary" }} />
			<Typography aria-hidden sx={{ fontSize: 36, fontWeight: 500, lineHeight: 1.05, letterSpacing: "-0.5px", minWidth: "2.2ch", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{level}</Typography>
		</Box>
		<VolumeMeter level={level} onChange={change} />
		<DriveButton color="inherit" aria-label="Louder" disabled={level >= 100} onClick={() => change(Math.floor(level / VOLUME_STEP) * VOLUME_STEP + VOLUME_STEP)} sx={CHEVRON}><ChevronRightRounded /></DriveButton>
	</Box>;
}

/**
 * The master volume.
 *  - "inline": the stepper and meter themselves, for the full player.
 *  - "button" (default): one large button showing the level; it opens the stepper in a card that closes itself a few seconds after the last touch.
 * There is no mute: pause the music instead.
 */
export default function MasterVolume({ variant = "button", buttonHeight = 80 }: { variant?: "button" | "inline"; buttonHeight?: number }) {
	const { level } = useMasterVolume();
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const arm = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setAnchor(null), IDLE_CLOSE_MS); };
	useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
	if (variant === "inline") return <Box sx={{ borderTop: "1px solid", borderColor: "divider" }}><VolumeSlider /></Box>;
	return <>
		<DriveButton color="inherit" aria-label={`Volume ${level}%. Change volume`} aria-haspopup="dialog" aria-expanded={!!anchor} onClick={(event) => { setAnchor(event.currentTarget); arm(); }} sx={{ minWidth: 120, minHeight: buttonHeight, gap: 0.75 }}>
			<VolumeUpRounded aria-hidden sx={{ fontSize: 30, color: "text.secondary" }} />
			<Typography aria-hidden sx={{ fontSize: 30, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{level}</Typography>
		</DriveButton>
		<Popover open={!!anchor} anchorEl={anchor} onClose={() => { if (timer.current) clearTimeout(timer.current); setAnchor(null); }}
			anchorOrigin={{ vertical: "top", horizontal: "center" }} transformOrigin={{ vertical: "bottom", horizontal: "center" }}
			slotProps={{ paper: { sx: (theme) => ({ mb: 1, width: "min(680px, calc(100vw - 32px))", bgcolor: alpha(theme.palette.background.paper, 0.92), backdropFilter: "blur(12px)", border: "1px solid", borderColor: "divider", borderRadius: 3, boxShadow: 6, backgroundImage: "none", overflow: "hidden" }) } }}>
			<VolumeSlider onTouch={arm} />
		</Popover>
	</>;
}
