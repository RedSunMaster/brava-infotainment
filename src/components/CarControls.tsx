import {
	AppsRounded,
	AcUnitRounded,
	FlashlightOnRounded,
	MusicNoteRounded,
	ThermostatRounded,
	VolumeUpRounded,
	WarningAmberRounded,
} from "@mui/icons-material";
import { Box, Popover, Slider, Typography } from "@mui/material";
import ClickAwayListener from "@mui/material/ClickAwayListener";
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
	color: "text.primary",
	minWidth: 92,
	minHeight: 92,
	p: 2,
	borderRadius: 2,
	border: "1px solid transparent",
	transition: "background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease",
	"&:hover": { backgroundColor: "action.hover" },
	"&:active": { backgroundColor: "rgba(255,176,0,0.2)" },
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
		sx={{ pointerEvents: "none" }}
		PaperProps={{
			sx: {
				pointerEvents: "auto",
				backgroundColor: "background.paper",
				border: "1px solid",
				borderColor: "divider",
				color: "text.primary",
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
					color: "text.secondary",
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
					color: "text.secondary",
					fontSize: 10,
					letterSpacing: 2,
				}}
			>
				FAN
			</Typography>
			<Typography
				sx={{
					color: "text.primary",
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
					color: "text.primary",
					"& .MuiSlider-rail": { backgroundColor: "divider" },
					"& .MuiSlider-track": { backgroundColor: "text.primary" },
					"& .MuiSlider-thumb": { backgroundColor: "background.paper" },
					"& .MuiSlider-mark": { backgroundColor: "text.disabled" },
					"& .MuiSlider-markActive": {
						backgroundColor: "text.secondary",
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
	onChangeCommitted: (v: number) => void;
	disabled: boolean;
}

const VolumeSliderPopup = ({
	anchorEl,
	onClose,
	value,
	onChange,
	onChangeCommitted,
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
					color: "text.secondary",
					fontSize: 10,
					letterSpacing: 2,
				}}
			>
				VOL
			</Typography>
			<Typography
				sx={{
					color: "text.primary",
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
					"& .MuiSlider-thumb": { backgroundColor: "background.paper" },
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
						color: "text.disabled",
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
		{
			icon: <AcUnitRounded sx={{ fontSize: 40 }} />,
			label: "A/C",
			onPress: onAC,
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
			sx={{ pointerEvents: "none" }}
			PaperProps={{
				sx: {
					pointerEvents: "auto",
					backgroundColor: "background.paper",
					border: "1px solid",
					borderColor: "divider",
					color: "text.primary",
					borderRadius: 3,
					p: 1.5,
				},
			}}
		>
			<Box sx={{ display: "flex", flexDirection: "row", gap: 1 }}>
				{subItems.map(({ icon, label, onPress }) => (
					<Box
						key={label}
						sx={{ ...iconBtnStyle, gap: 0.5, color: "text.primary" }}
						onClick={onPress}
					>
						{icon}
						<Typography
							variant="caption"
							sx={{
								color: "text.secondary",
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

const CarControls = ({ isDriving }: { isDriving: boolean }) => {
	const hazardRef = useRef<HTMLDivElement>(null);
	const spotify = useSpotify();
	const [localVolume, setLocalVolume] = useState(50);

	const [activePopup, setActivePopup] = useState<
		"spotify" | "multiApp" | "temp" | "fan" | "volume" | null
	>(null);

	const close = () => setActivePopup(null);

	const toggle = (popup: NonNullable<typeof activePopup>) =>
		setActivePopup((prev) => (prev === popup ? null : popup));

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

	const [temp, setTemp] = useState(5);
	const [fanSpeed, setFanSpeed] = useState(3);

	const handleRearHeat = () => console.log("rear heat toggled");
	const handleFogLeft = () => console.log("fog left toggled");
	const handleFogRight = () => console.log("fog right toggled");
	const handleAirDir = () => console.log("air direction pressed");

	return (
		<ClickAwayListener onClickAway={close}>
			<Box
				sx={{
					display: "flex",
					alignItems: "center",
					width: "100%",
					height: "100%",
					color: "text.primary",
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
							color: spotify.isConnected ? "text.primary" : "text.disabled",
							backgroundColor:
								activePopup === "volume" ? "rgba(255,176,0,0.16)" : "transparent",
							borderColor:
								activePopup === "volume" ? "rgba(255,176,0,0.45)" : "transparent",
						}}
						onClick={() => {
							setLocalVolume(spotify.volume);
							toggle("volume");
						}}
					>
						<VolumeUpRounded sx={{ fontSize: 56 }} />
					</Box>

					{/* Music */}
					<Box
						sx={{
							...iconBtnStyle,
							backgroundColor:
								activePopup === "spotify" ? "rgba(255,176,0,0.16)" : "transparent",
							borderColor:
								activePopup === "spotify" ? "rgba(255,176,0,0.45)" : "transparent",
						}}
						onClick={() => toggle("spotify")}
					>
						<MusicNoteRounded sx={{ fontSize: 56 }} />
					</Box>

					{/* Multi-App */}
					<Box
						sx={{
							...iconBtnStyle,
							backgroundColor:
								activePopup === "multiApp" ? "rgba(255,176,0,0.16)" : "transparent",
							borderColor:
								activePopup === "multiApp" ? "rgba(255,176,0,0.45)" : "transparent",
						}}
						onClick={() => toggle("multiApp")}
					>
						<AppsRounded sx={{ fontSize: 56 }} />
					</Box>
				</Box>

				{/* ── Centre: Hazard ───────────────────────────────────────────────── */}
				<Box
					ref={hazardRef}
					sx={{
						...iconBtnStyle,
						flexShrink: 0,
						color: hazardOn
							? hazardFlash
								? "#FF3B30"
								: "text.disabled"
							: "text.primary",
						backgroundColor: hazardOn ? "rgba(255,59,48,0.18)" : "transparent",
						borderColor: hazardOn ? "rgba(255,59,48,0.55)" : "transparent",
						transition: hazardOn ? "color 0.1s ease" : "color 0.15s ease",
					}}
					onClick={handleHazard}
				>
					<WarningAmberRounded sx={{ fontSize: 82 }} />
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
					<Box
						sx={{
							...iconBtnStyle,
							backgroundColor:
								activePopup === "temp" ? "rgba(255,176,0,0.16)" : "transparent",
							borderColor:
								activePopup === "temp" ? "rgba(255,176,0,0.45)" : "transparent",
						}}
						onClick={() => toggle("temp")}
					>
						<ThermostatRounded sx={{ fontSize: 56 }} />
					</Box>

					{/* Fan */}
					<Box
						sx={{
							...iconBtnStyle,
							color: fanSpeed > 0 ? "info.main" : "text.disabled",
							backgroundColor:
								activePopup === "fan" ? "rgba(56,189,248,0.15)" : "transparent",
							borderColor:
								activePopup === "fan" ? "rgba(56,189,248,0.45)" : "transparent",
						}}
						onClick={() => toggle("fan")}
					>
						{fanSpeed === 0 ? (
							<FanOffIcon style={{ ...svgIconStyle, width: 56, height: 56 }} />
						) : (
							<FanOnIcon style={{ ...svgIconStyle, width: 56, height: 56 }} />
						)}
					</Box>
				</Box>

				{/* ── All popups ────────────────────────────────────────────────────── */}
				<VolumeSliderPopup
					anchorEl={activePopup === "volume" ? hazardRef.current : null}
					onClose={close}
					value={localVolume}
					onChange={setLocalVolume}
					onChangeCommitted={spotify.setVolume}
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
					isDriving={isDriving}
				/>
			</Box>
		</ClickAwayListener>
	);
};

export default CarControls;
