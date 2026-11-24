import React, { useEffect, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import SystemUpdateAltRounded from "@mui/icons-material/SystemUpdateAltRounded";
import PhoneAndroidRounded from "@mui/icons-material/PhoneAndroidRounded";
import PhonelinkOffRounded from "@mui/icons-material/PhonelinkOffRounded";
import { usePhoneLink } from "../hooks/usePhoneLink";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import WbSunnyRounded from "@mui/icons-material/WbSunnyRounded";
import CloudRounded from "@mui/icons-material/CloudRounded";
import GrainRounded from "@mui/icons-material/GrainRounded";
import AcUnitRounded from "@mui/icons-material/AcUnitRounded";
import FlashOnRounded from "@mui/icons-material/FlashOnRounded";
import BlurOnRounded from "@mui/icons-material/BlurOnRounded";
import WbTwilightRounded from "@mui/icons-material/WbTwilightRounded";
import { GpsStatus } from "../hooks/useGps";
import GpsIndicator, { gpsDescription } from "./GpsIndicator";
import { useThemeMode } from "../ThemeContext";
import { useProfiles } from "../contexts/ProfileContext";
import { Avatar } from "./ProfileDialog";

function wmoIcon(code: number) {
	if (code === 0) return <WbSunnyRounded sx={{ fontSize: 28 }} />;
	if (code <= 3) return <WbTwilightRounded sx={{ fontSize: 28 }} />;
	if (code <= 48) return <BlurOnRounded sx={{ fontSize: 28 }} />;
	if (code <= 67) return <GrainRounded sx={{ fontSize: 28 }} />;
	if (code <= 77) return <AcUnitRounded sx={{ fontSize: 28 }} />;
	if (code <= 82) return <CloudRounded sx={{ fontSize: 28 }} />;
	return <FlashOnRounded sx={{ fontSize: 28 }} />;
}

function wmoLabel(code: number) {
	if (code === 0) return "Clear";
	if (code <= 3) return "Cloudy";
	if (code <= 48) return "Foggy";
	if (code <= 67) return "Rain";
	if (code <= 77) return "Snow";
	if (code <= 82) return "Showers";
	return "Storm";
}

// Shared look for read-only status chips (clock, weather, GPS, drive state).
// Smaller and flatter than buttons so they do not read as tappable.
export function statusChipSx(theme: Theme) {
	return {
		display: "flex",
		alignItems: "center",
		gap: 0.75,
		px: 1.5,
		height: 56,
		boxSizing: "border-box" as const,
		background: alpha(theme.palette.surface.main, 0.94),
		border: `1px solid ${alpha(theme.palette.text.primary, 0.16)}`,
		borderRadius: "10px",
		color: theme.palette.text.primary,
		whiteSpace: "nowrap" as const,
	};
}

interface Props {
	position: [number, number];
	gpsStatus: GpsStatus;
	estimating?: boolean;
	/** The app is running as a display preview, not in the car. */
	previewMode?: boolean;
	/** Tapping the driver's icon at the right end opens the profile switcher. */
	onProfile?: () => void;
	/** Tapping the phone button opens the list of phone notifications. */
	onPhone?: () => void;
}

/** A thin rule between the strip's three parts. */
function Divider() {
	return <Box aria-hidden sx={{ width: "1px", height: 28, flexShrink: 0, bgcolor: (theme) => alpha(theme.palette.text.primary, 0.2) }} />;
}

/**
 * The status bar: time on the left, weather and GPS on the right, running edge to edge along the top
 * of the screen. Everything shares one size of text and icon; the only colour is the GPS status, so
 * a problem stands out, and the bar's lower edge picks up that colour too.
 */
export default function ClockWeatherChip({ gpsStatus, estimating = false, previewMode = false, onProfile, onPhone }: Props) {
	const phone = usePhoneLink();
	const { active } = useProfiles();
	const theme = useTheme();
	const [time, setTime] = useState(new Date());
	const { weather } = useThemeMode();
	const { state: update, apply: applyUpdate, checkNow, checking, lastResult } = useAppUpdate();

	// The clock only shows minutes, so it only needs to tick when the minute changes.
	useEffect(() => {
		const id = setInterval(() => setTime(new Date()), 5000);
		return () => clearInterval(id);
	}, []);

	const clock = time.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" });
	const simulated = previewMode && gpsStatus !== "fix" && !estimating;
	const accent = gpsStatus === "fix" || simulated ? null : gpsStatus === "disconnected" && !estimating ? theme.palette.error.main : theme.palette.warning.main;
	const text = { fontSize: 26, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums" as const };

	return (
		<Box
			role="status"
			aria-label={`${clock}${weather ? `, ${weather.temp} degrees, ${wmoLabel(weather.code)}` : ""}, ${simulated ? "preview mode" : gpsDescription(gpsStatus, estimating)}`}
			sx={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 2,
				width: "100%",
				height: 48,
				px: 3,
				boxSizing: "border-box",
				background: alpha(theme.palette.surface.main, 0.94),
				borderBottom: `${accent ? 3 : 1}px solid ${accent ?? alpha(theme.palette.text.primary, 0.16)}`,
				color: theme.palette.text.primary,
				whiteSpace: "nowrap",
			}}
		>
			<Typography sx={text}>{clock}</Typography>
			<Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
				{update.phase === "idle" && update.supported && (
					<>
						<Box
							component="button" type="button" disabled={checking} onClick={checkNow}
							aria-label="Check for updates"
							sx={{ display: "flex", alignItems: "center", gap: 0.75, height: 44, px: 1.25, border: `1px solid ${alpha(theme.palette.text.primary, 0.16)}`, borderRadius: 8, bgcolor: "transparent", color: "text.secondary", cursor: checking ? "default" : "pointer", font: "inherit", "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main" } }}
						>
							{checking ? <CircularProgress size={24} color="inherit" /> : <SystemUpdateAltRounded sx={{ fontSize: 28 }} />}
							<Typography sx={{ ...text, color: "inherit" }}>{checking ? "Checking…" : lastResult === "up-to-date" ? "Up to date" : lastResult === "failed" ? "Check failed" : "Check for updates"}</Typography>
						</Box>
						<Divider />
					</>
				)}
				{update.phase !== "idle" && (() => {
					const busy = update.phase === "updating";
					const failed = update.phase === "failed";
					const colour = failed ? theme.palette.error.main : theme.palette.primary.main;
					return <>
						<Box
							component="button" type="button" disabled={busy} onClick={applyUpdate}
							aria-label={busy ? "Updating the app" : failed ? "Update failed. Tap to try again" : `Update available${update.subject ? `: ${update.subject}` : ""}. Tap to install and restart`}
							sx={{ display: "flex", alignItems: "center", gap: 0.75, height: 44, px: 1.25, border: `2px solid ${colour}`, borderRadius: 8, bgcolor: alpha(colour, 0.14), color: colour, cursor: busy ? "default" : "pointer", font: "inherit", "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main" } }}
						>
							{busy ? <CircularProgress size={24} color="inherit" /> : <SystemUpdateAltRounded sx={{ fontSize: 28 }} />}
							<Typography sx={{ ...text, color: "inherit" }}>{busy ? "Updating…" : failed ? "Retry update" : "Update"}</Typography>
						</Box>
						<Divider />
					</>;
				})()}
				{onPhone && phone.visible && (
					<>
						<Box
							component="button" type="button" onClick={onPhone}
							aria-label={`Phone: ${phone.connection.connected ? "connected" : "not connected"}${phone.unread ? `, ${phone.unread} new notification${phone.unread === 1 ? "" : "s"}` : ""}. Open notifications`}
							sx={{ display: "flex", alignItems: "center", gap: 0.75, height: 44, px: 1.25, border: `1px solid ${phone.unread ? theme.palette.primary.main : alpha(theme.palette.text.primary, 0.16)}`, borderRadius: 8, bgcolor: phone.unread ? alpha(theme.palette.primary.main, 0.14) : "transparent", color: phone.connection.connected ? (phone.unread ? "primary.main" : "text.primary") : "text.disabled", cursor: "pointer", font: "inherit" }}
						>
							{phone.connection.connected ? <PhoneAndroidRounded sx={{ fontSize: 28 }} /> : <PhonelinkOffRounded sx={{ fontSize: 28 }} />}
							{phone.unread > 0 && <Typography sx={{ ...text, color: "inherit" }}>{phone.unread > 9 ? "9+" : phone.unread}</Typography>}
						</Box>
						<Divider />
					</>
				)}
				{weather && (
					<>
						<Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "text.secondary" }}>
							{wmoIcon(weather.code)}
							<Typography sx={{ ...text, color: "text.primary" }}>{weather.temp}&deg;</Typography>
						</Box>
						<Divider />
					</>
				)}
				<GpsIndicator status={gpsStatus} estimating={estimating} preview={previewMode} />
				{onProfile && <>
					<Divider />
					<Box component="button" type="button" aria-label={`Driver: ${active.name}. Change profile`} onClick={onProfile} sx={{ display: "flex", alignItems: "center", gap: 1, height: 44, px: 0.75, border: 0, borderRadius: 8, bgcolor: "transparent", color: "inherit", cursor: "pointer", font: "inherit", "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main" } }}>
						<Avatar profile={active} size={38} />
						<Typography sx={{ ...text, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{active.name}</Typography>
					</Box>
				</>}
			</Box>
		</Box>
	);
}
