import {
	AcUnitRounded,
	AppsRounded,
	CarCrashRounded,
	FlashlightOnRounded,
	MusicNoteRounded,
	ThermostatRounded,
	VolumeUpRounded,
} from "@mui/icons-material";
import { Box, Popover, Slider, Typography } from "@mui/material";
import React, { useEffect, useRef, useState } from "react";

import FanOffIcon from "../../public/icons/fanOff.svg";
import FanOnIcon from "../../public/icons/fanOn.svg";
import FanFocusIcon from "../../public/icons/fanFocus.svg";
import RearDefrostIcon from "../../public/icons/rearWindshieldDefrost.svg";
import { useSpotify } from "../hooks/useSpotify";
import SpotifyPopup from "./SpotifyPopup";

// ─── Shared styles ────────────────────────────────────────────────────────────

const iconBtnStyle = {
	display: "flex",
	flexDirection: "column" as const,
	alignItems: "center",
	justifyContent: "center",
	cursor: "pointer",
	color: "white",
	p: 1.5,
	borderRadius: 2,
	transition: "background-color 0.15s ease",
	"&:hover": { backgroundColor: "rgba(255,255,255,0.1)" },
	"&:active": { backgroundColor: "rgba(255,255,255,0.2)" },
};

const svgIconStyle: React.CSSProperties = {
	fill: "currentColor",
};

// ─── Shared Slider Popup wrapper ──────────────────────────────────────────────

interface SliderPopupProps {
	anchorEl: HTMLElement | null;
	onClose: () => void;
	children: React.ReactNode;
}

const SliderPopup = ({ anchorEl, onClose, children }: SliderPopupProps) => (
	<Popover
		open={Boolean(anchorEl)}
		anchorEl={anchorEl}
		onClose={onClose}
		anchorOrigin={{ vertical: "top", horizontal: "center" }}
		transformOrigin={{ vertical: "bottom", horizontal: "center" }}
		disablePortal
		marginThreshold={0}
		PaperProps={{
			sx: {
				backgroundColor: "#1a1a1a",
				border: "1px solid rgba(255,255,255,0.15)",
				borderRadius: 3,
				p: 2.5,
				width: 100,
				overflow: "visible",
			},
		}}
	>
		{children}
	</Popover>
);

// ─── Temperature Slider Popup ─────────────────────────────────────────────────

interface TempSliderPopupProps {
	anchorEl: HTMLElement | null;
	onClose: () => void;
	value: number;
	onChange: (v: number) => void;
}

const TempSliderPopup = ({
	anchorEl,
	onClose,
	value,
	onChange,
}: TempSliderPopupProps) => (
	<SliderPopup anchorEl={anchorEl} onClose={onClose}>
		<Box
			sx={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 1.5,
				width: "100%",
			}}
		>
			<Typography
				sx={{
					color: "rgba(255,255,255,0.5)",
					fontSize: 10,
					letterSpacing: 2,
				}}
			>
				TEMP
			</Typography>
			<Slider
				orientation="vertical"
				value={value}
				onChange={(_, v) => onChange(v as number)}
				min={0}
				max={10}
				step={1}
				marks
				sx={{
					height: 240,
					width: 36,
					"& .MuiSlider-rail": {
						background:
							"linear-gradient(to top, #3b82f6 0%, #ffffff 50%, #ef4444 100%)",
						opacity: 1,
					},
					"& .MuiSlider-track": { display: "none" },
					"& .MuiSlider-thumb": {
						backgroundColor: "white",
						border: "3px solid rgba(255,255,255,0.6)",
					},
					"& .MuiSlider-mark": { backgroundColor: "rgba(0,0,0,0.3)" },
					"& .MuiSlider-markActive": { backgroundColor: "rgba(0,0,0,0.3)" },
				}}
			/>
		</Box>
	</SliderPopup>
);

// ─── Fan Slider Popup ─────────────────────────────────────────────────────────

interface FanSliderPopupProps {
	anchorEl: HTMLElement | null;
	onClose: () => void;
	value: number;
	onChange: (v: number) => void;
}

const FanSliderPopup = ({
	anchorEl,
	onClose,
	value,
	onChange,
}: FanSliderPopupProps) => (
	<SliderPopup anchorEl={anchorEl} onClose={onClose}>
		<Box
			sx={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 1.5,
				width: "100%",
			}}
		>
			<Typography
				sx={{
					color: "rgba(255,255,255,0.5)",
					fontSize: 10,
					letterSpacing: 2,
				}}
			>
				FAN
			</Typography>
			<Typography
				sx={{
					color: "white",
					fontSize: 28,
					fontWeight: 700,
					lineHeight: 1,
				}}
			>
				{value}
			</Typography>
			<Slider
				orientation="vertical"
				value={value}
				onChange={(_, v) => onChange(v as number)}
				min={0}
				max={10}
				step={1}
				marks
				sx={{
					height: 240,
					width: 36,
					color: "white",
					"& .MuiSlider-rail": { backgroundColor: "rgba(255,255,255,0.2)" },
					"& .MuiSlider-track": { backgroundColor: "white" },
					"& .MuiSlider-thumb": { backgroundColor: "white" },
					"& .MuiSlider-mark": { backgroundColor: "rgba(255,255,255,0.3)" },
					"& .MuiSlider-markActive": {
						backgroundColor: "rgba(255,255,255,0.7)",
					},
				}}
			/>
		</Box>
	</SliderPopup>
);

// ─── Volume Slider Popup ──────────────────────────────────────────────────────

interface VolumeSliderPopupProps {
	anchorEl: HTMLElement | null;
	onClose: () => void;
	value: number;
	onChange: (v: number) => void;
	onChangeCommitted: (v: number) => void; // ← new
	disabled: boolean;
}

const VolumeSliderPopup = ({
	anchorEl,
	onClose,
	value,
	onChange,
	onChangeCommitted, // ← new
	disabled,
}: VolumeSliderPopupProps) => (
	<SliderPopup anchorEl={anchorEl} onClose={onClose}>
		<Box
			sx={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 1.5,
				width: "100%",
			}}
		>
			<Typography
				sx={{
					color: "rgba(255,255,255,0.5)",
					fontSize: 10,
					letterSpacing: 2,
				}}
			>
				VOL
			</Typography>
			<Typography
				sx={{
					color: "white",
					fontSize: 28,
					fontWeight: 700,
					lineHeight: 1,
				}}
			>
				{value}
			</Typography>
			<Slider
				orientation="vertical"
				value={value}
				onChange={(_, v) => onChange(v as number)}
				onChangeCommitted={(_, v) => onChangeCommitted(v as number)}
				min={0}
				max={100}
				step={5}
				marks
				disabled={disabled}
				sx={{
					height: 240,
					width: 36,
					color: "#1DB954",
					"& .MuiSlider-rail": { backgroundColor: "rgba(255,255,255,0.2)" },
					"& .MuiSlider-track": { backgroundColor: "#1DB954" },
					"& .MuiSlider-thumb": { backgroundColor: "white" },
					"& .MuiSlider-mark": { backgroundColor: "rgba(255,255,255,0.3)" },
					"& .MuiSlider-markActive": {
						backgroundColor: "rgba(29,185,84,0.5)",
					},
					"&.Mui-disabled": { color: "rgba(255,255,255,0.2)" },
				}}
			/>
			{disabled && (
				<Typography
					sx={{
						color: "rgba(255,255,255,0.3)",
						fontSize: 9,
						textAlign: "center",
					}}
				>
					Connect Spotify
				</Typography>
			)}
		</Box>
	</SliderPopup>
);

// ─── Multi-App Popup ──────────────────────────────────────────────────────────

interface MultiAppPopupProps {
	anchorEl: HTMLElement | null;
	onClose: () => void;
	onRearHeat: () => void;
	onFogLeft: () => void;
	onFogRight: () => void;
	onAirDir: () => void;
	onAC: () => void;
}

const MultiAppPopup = ({
	anchorEl,
	onClose,
	onRearHeat,
	onFogLeft,
	onFogRight,
	onAirDir,
	onAC,
}: MultiAppPopupProps) => {
	const subItems = [
		{
			icon: (
				<RearDefrostIcon style={{ ...svgIconStyle, width: 40, height: 40 }} />
			),
			label: "Rear Heat",
			onPress: onRearHeat,
		},
		{
			icon: (
				<FlashlightOnRounded sx={{ fontSize: 40, transform: "scaleX(-1)" }} />
			),
			label: "Fog Left",
			onPress: onFogLeft,
		},
		{
			icon: <FlashlightOnRounded sx={{ fontSize: 40 }} />,
			label: "Fog Right",
			onPress: onFogRight,
		},
		{
			icon: <FanFocusIcon style={{ ...svgIconStyle, width: 40, height: 40 }} />,
			label: "Air Dir.",
			onPress: onAirDir,
		},
	];

	return (
		<Popover
			open={Boolean(anchorEl)}
			anchorEl={anchorEl}
			onClose={onClose}
			anchorOrigin={{ vertical: "top", horizontal: "center" }}
			transformOrigin={{ vertical: "bottom", horizontal: "center" }}
			disablePortal
			marginThreshold={0}
			PaperProps={{
				sx: {
					backgroundColor: "#1a1a1a",
					border: "1px solid rgba(255,255,255,0.15)",
					borderRadius: 3,
					p: 1.5,
				},
			}}
		>
			<Box sx={{ display: "flex", flexDirection: "row", gap: 1 }}>
				{subItems.map(({ icon, label, onPress }) => (
					<Box
						key={label}
						sx={{ ...iconBtnStyle, gap: 0.5, color: "white" }}
						onClick={onPress}
					>
						{icon}
						<Typography
							variant="caption"
							sx={{
								color: "rgba(255,255,255,0.65)",
								fontSize: 9,
								textAlign: "center",
							}}
						>
							{label}
						</Typography>
					</Box>
				))}
			</Box>
		</Popover>
	);
};

// ─── Main Component ───────────────────────────────────────────────────────────

const CarControls = () => {
	const hazardRef = useRef<HTMLDivElement>(null);
	const spotify = useSpotify();
	const [localVolume, setLocalVolume] = useState(50);

	// Popup state — only one open at a time
	const [activePopup, setActivePopup] = useState<
		"spotify" | "multiApp" | "temp" | "fan" | "volume" | null
	>(null);
	const close = () => setActivePopup(null);

	// Hazard flash
	const [hazardOn, setHazardOn] = useState(false);
	const [hazardFlash, setHazardFlash] = useState(false);
	const hazardIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		return () => {
			if (hazardIntervalRef.current) clearInterval(hazardIntervalRef.current);
		};
	}, []);

	const handleHazard = () => {
		if (hazardOn) {
			setHazardOn(false);
			if (hazardIntervalRef.current) {
				clearInterval(hazardIntervalRef.current);
				hazardIntervalRef.current = null;
			}
			setHazardFlash(false);
		} else {
			setHazardOn(true);
			setHazardFlash(true);
			hazardIntervalRef.current = setInterval(() => {
				setHazardFlash((f) => !f);
			}, 500);
		}
	};

	// Slider values
	const [temp, setTemp] = useState(5);
	const [fanSpeed, setFanSpeed] = useState(3);

	// Handlers
	const handleRearHeat = () => console.log("rear heat toggled");
	const handleFogLeft = () => console.log("fog left toggled");
	const handleFogRight = () => console.log("fog right toggled");
	const handleAirDir = () => console.log("air direction pressed");

	return (
		<Box
			sx={{
				display: "flex",
				alignItems: "center",
				width: "100%",
				height: "100%",
			}}
		>
			{/* ── Left group ───────────────────────────────────────────────────── */}
			<Box
				sx={{
					display: "flex",
					flex: 1,
					justifyContent: "space-evenly",
					alignItems: "center",
				}}
			>
				{/* Volume */}
				<Box
					sx={{
						...iconBtnStyle,
						color: spotify.isConnected ? "white" : "rgba(255,255,255,0.35)",
					}}
					onClick={() => {
						setLocalVolume(spotify.volume); // snapshot current volume on open
						setActivePopup("volume");
					}}
				>
					<VolumeUpRounded sx={{ fontSize: 48 }} />
				</Box>

				{/* Music */}
				<Box sx={iconBtnStyle} onClick={() => setActivePopup("spotify")}>
					<MusicNoteRounded sx={{ fontSize: 48 }} />
				</Box>

				{/* Multi-App */}
				<Box sx={iconBtnStyle} onClick={() => setActivePopup("multiApp")}>
					<AppsRounded sx={{ fontSize: 48 }} />
				</Box>
			</Box>

			{/* ── Centre: Hazard (always mathematically centred) ───────────────── */}
			<Box
				ref={hazardRef}
				sx={{
					...iconBtnStyle,
					flexShrink: 0,
					color: hazardOn
						? hazardFlash
							? "#ff3333"
							: "rgba(255,255,255,0.15)"
						: "white",
					transition: hazardOn ? "color 0.1s ease" : "color 0.15s ease",
				}}
				onClick={handleHazard}
			>
				<CarCrashRounded sx={{ fontSize: 72 }} />
			</Box>

			{/* ── Right group ──────────────────────────────────────────────────── */}
			<Box
				sx={{
					display: "flex",
					flex: 1,
					justifyContent: "space-evenly",
					alignItems: "center",
				}}
			>
				{/* Temp */}
				<Box sx={iconBtnStyle} onClick={() => setActivePopup("temp")}>
					<ThermostatRounded sx={{ fontSize: 48 }} />
				</Box>

				{/* Fan */}
				<Box
					sx={{ ...iconBtnStyle, color: "white" }}
					onClick={() => setActivePopup("fan")}
				>
					{fanSpeed === 0 ? (
						<FanOffIcon style={{ ...svgIconStyle, width: 48, height: 48 }} />
					) : (
						<FanOnIcon style={{ ...svgIconStyle, width: 48, height: 48 }} />
					)}
				</Box>
			</Box>

			{/* ── All popups — anchored to hazard button ────────────────────────── */}
			<VolumeSliderPopup
				anchorEl={activePopup === "volume" ? hazardRef.current : null}
				onClose={close}
				value={localVolume}
				onChange={setLocalVolume} // ← instant local update
				onChangeCommitted={spotify.setVolume} // ← API call on release only
				disabled={!spotify.isConnected}
			/>
			<MultiAppPopup
				anchorEl={activePopup === "multiApp" ? hazardRef.current : null}
				onClose={close}
				onRearHeat={handleRearHeat}
				onFogLeft={handleFogLeft}
				onFogRight={handleFogRight}
				onAirDir={handleAirDir}
				onAC={() => console.log("A/C toggled")}
			/>
			<TempSliderPopup
				anchorEl={activePopup === "temp" ? hazardRef.current : null}
				onClose={close}
				value={temp}
				onChange={setTemp}
			/>
			<FanSliderPopup
				anchorEl={activePopup === "fan" ? hazardRef.current : null}
				onClose={close}
				value={fanSpeed}
				onChange={setFanSpeed}
			/>
			<SpotifyPopup
				anchorEl={activePopup === "spotify" ? hazardRef.current : null}
				onClose={close}
				spotify={spotify}
			/>
		</Box>
	);
};

export default CarControls;
