import React, { useEffect, useState } from "react";
import { Box, Collapse, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { ExpandMoreRounded } from "@mui/icons-material";
import { getManeuverIcon } from "../lib/maneuverIcon";
import type { NormalizedManeuver } from "../lib/routing";

interface Props {
	maneuvers: NormalizedManeuver[];
	currentStep: number;
	distanceToNextM?: number | null;
	timeToNextS?: number | null;
	isDriving: boolean;
	onExpandedChange?: (expanded: boolean) => void;
}

function distanceLabel(meters: number | null | undefined, fallbackKm?: number) {
	if (meters != null) {
		return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
	}
	if (fallbackKm == null) return "";
	return fallbackKm >= 1 ? `${fallbackKm.toFixed(1)} km` : `${Math.round(fallbackKm * 1000)} m`;
}

function timeLabel(seconds: number | null | undefined, fallbackSeconds?: number) {
	const value = seconds ?? fallbackSeconds;
	if (value == null) return "";
	if (value >= 3600) {
		return `${Math.floor(value / 3600)}h ${Math.round((value % 3600) / 60)}m`;
	}
	return `${Math.max(1, Math.ceil(value / 60))} min`;
}

export default function NavigationCard({
	maneuvers,
	currentStep,
	distanceToNextM,
	timeToNextS,
	isDriving,
	onExpandedChange,
}: Props) {
	const [expanded, setExpanded] = useState(false);
	const theme = useTheme();
	const current = maneuvers[currentStep + 1];
	const upcoming = maneuvers.slice(
		currentStep + 2,
		currentStep + (isDriving ? 3 : 4),
	);

	useEffect(() => {
		onExpandedChange?.(expanded);
	}, [expanded, onExpandedChange]);

	useEffect(() => {
		if (!expanded || !isDriving) return;
		const id = window.setTimeout(() => setExpanded(false), 5500);
		return () => window.clearTimeout(id);
	}, [expanded, isDriving]);

	useEffect(() => {
		setExpanded(false);
	}, [currentStep]);

	if (!current) return null;
	const CurrentIcon = getManeuverIcon(current);

	return (
		<Box
			onClick={() => setExpanded((e) => !e)}
			sx={{ cursor: "pointer", userSelect: "none" }}
		>
			<Box
				sx={(theme) => ({
					background: alpha(theme.palette.surface.main, 0.97),
					backdropFilter: "blur(10px)",
					borderRadius: expanded ? "12px 12px 0 0" : "12px",
					padding: "14px 18px",
					display: "flex",
					alignItems: "center",
					gap: 1.5,
					boxShadow: "0 5px 24px rgba(0,0,0,0.62)",
					border: `1px solid ${alpha(theme.palette.text.primary, 0.16)}`,
					transition: "border-radius 0.2s",
				})}
			>
				<Box
					sx={(theme) => ({
						width: 60,
						height: 60,
						borderRadius: "12px",
						background: theme.palette.primary.main,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						flexShrink: 0,
						boxShadow: `0 4px 18px ${alpha(theme.palette.primary.main, 0.38)}`,
					})}
				>
					<CurrentIcon
						sx={{ fontSize: 36, color: theme.palette.primary.contrastText }}
					/>
				</Box>

				<Box sx={{ flex: 1, minWidth: 0 }}>
					<Typography
						sx={{
							color: theme.palette.text.primary,
							fontSize: 19,
							fontWeight: 800,
							lineHeight: 1.25,
							wordBreak: "break-word",
							whiteSpace: "normal",
						}}
					>
						{current.instruction}
					</Typography>
					<Typography
						sx={{
							color: alpha(theme.palette.text.primary, 0.72),
							fontSize: 15,
							fontWeight: 700,
							mt: 0.4,
						}}
					>
						{distanceLabel(distanceToNextM, current.length)}
						{" \u00B7 "}
						{timeLabel(timeToNextS, current.time)}
					</Typography>
				</Box>

				<Box
					sx={{
						color: alpha(theme.palette.text.primary, 0.75),
						transition: "transform 0.2s",
						transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
						flexShrink: 0,
						display: "flex",
					}}
				>
					<ExpandMoreRounded sx={{ fontSize: 30 }} />
				</Box>
			</Box>

			<Collapse in={expanded}>
				<Box
					sx={(theme) => ({
						background: alpha(theme.palette.surface.main, 0.97),
						backdropFilter: "blur(10px)",
						borderRadius: "0 0 12px 12px",
						border: `1px solid ${alpha(theme.palette.text.primary, 0.16)}`,
						borderTopWidth: 0,
						boxShadow: "0 8px 24px rgba(0,0,0,0.58)",
					})}
				>
					{upcoming.length === 0 && (
						<Typography
							sx={{
								color: theme.palette.text.secondary,
								fontSize: 12,
								p: "10px 16px",
							}}
						>
							No further steps
						</Typography>
					)}
					{upcoming.map((m, i) => {
						const StepIcon = getManeuverIcon(m);
						return (
							<Box
								key={`${m.begin_shape_index}-${i}`}
								sx={(theme) => ({
									display: "flex",
									alignItems: "center",
									gap: 1.5,
									padding: "12px 16px",
									borderTop:
										i > 0
											? `1px solid ${alpha(theme.palette.text.primary, 0.05)}`
											: "none",
								})}
							>
								<Box
									sx={(theme) => ({
										width: 42,
										height: 42,
										borderRadius: "8px",
										background: alpha(theme.palette.primary.main, 0.2),
										border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										flexShrink: 0,
									})}
								>
									<StepIcon sx={{ fontSize: 24, color: theme.palette.primary.main }} />
								</Box>
								<Box sx={{ flex: 1, minWidth: 0 }}>
									<Typography
										sx={{
											color: theme.palette.text.primary,
											fontSize: 15,
											fontWeight: 600,
											lineHeight: 1.22,
											overflow: "hidden",
											display: "-webkit-box",
											WebkitLineClamp: isDriving ? 2 : 1,
											WebkitBoxOrient: "vertical",
										}}
									>
										{m.instruction}
									</Typography>
									<Typography sx={{ color: "text.secondary", fontSize: 11, mt: 0.35 }}>
										{distanceLabel(null, m.length)}
									</Typography>
								</Box>
							</Box>
						);
					})}
				</Box>
			</Collapse>
		</Box>
	);
}
