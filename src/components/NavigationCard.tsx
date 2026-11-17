import React, { useEffect, useState } from "react";
import { Box, Collapse, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import { getManeuverIcon } from "../lib/maneuverIcon";
import type { NormalizedManeuver } from "../lib/routing";
import { glanceLabel } from "../lib/maneuverText";
import { usefulLanes } from "../lib/laneGuidance";
import LaneGuidance from "./LaneGuidance";
import ReplayRounded from "@mui/icons-material/ReplayRounded";

interface Props {
	/** Says the current instruction again; works even when guidance is muted. */
	onRepeat?: () => void;
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

export default function NavigationCard({
	maneuvers,
	currentStep,
	distanceToNextM,
	isDriving,
	onExpandedChange,
	onRepeat,
}: Props) {
	const [expanded, setExpanded] = useState(false);
	const theme = useTheme();
	const current = maneuvers[currentStep + 1];
	const junction = distanceToNextM == null ? undefined : maneuvers[currentStep]?.junctions?.filter(item => distanceToNextM <= item.distance).sort((a, b) => a.distance - b.distance)[0];
	const lanes = usefulLanes(current?.lanes, distanceToNextM);
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
	// The routing service words an intermediate stop as "You have arrived at
	// your destination"; say what it really is so the trip does not look over.
	const isIntermediateStop =
		current.type === "arrive" && currentStep + 1 < maneuvers.length - 1;
	const label = isIntermediateStop
		? "Your stop"
		: glanceLabel(current.instruction);

	return (
		<Box
			role="button" tabIndex={0} aria-label="Show upcoming turns" aria-expanded={expanded}
			onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setExpanded(value => !value); } }}
			onClick={() => setExpanded((e) => !e)}
			sx={{ cursor: "pointer", userSelect: "none", position: "relative", zIndex: 25 }}
		>
			<Box
				sx={(theme) => ({
					background: alpha(theme.palette.surface.main, 0.97),
					backdropFilter: "blur(10px)",
					borderRadius: "12px",
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
						width: 100,
						height: 100,
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
						sx={{ fontSize: 60, color: theme.palette.primary.contrastText }}
					/>
				</Box>

				<Box sx={{ flex: 1, minWidth: 0 }}>
					<Typography
						sx={{
							color: theme.palette.text.primary,
							fontSize: 48,
							fontWeight: 800,
							lineHeight: 1.15,
							wordBreak: "break-word",
							whiteSpace: "normal",
						}}
					>
						{distanceLabel(distanceToNextM, current.length)}
					</Typography>
					{/* Road name only, large enough to read in a glance; the arrow carries the manoeuvre. */}
					<Typography
						sx={{
							color: theme.palette.text.primary,
							fontSize: 40,
							fontWeight: 700,
							lineHeight: 1.15,
							mt: 0.4,
							overflow: "hidden",
							display: "-webkit-box",
							WebkitLineClamp: 2,
							WebkitBoxOrient: "vertical",
						}}
					>
						{label}
					</Typography>
						{lanes && <LaneGuidance lanes={lanes} modifier={current.modifier} />}
					{label !== current.instruction && (
						<Box component="span" sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" }}>
							{current.instruction}
						</Box>
					)}
				</Box>

					{onRepeat && (
						<Box
							component="button"
							type="button"
							aria-label="Repeat instruction"
							onClick={(event: React.MouseEvent) => { event.stopPropagation(); onRepeat(); }}
							onKeyDown={(event: React.KeyboardEvent) => event.stopPropagation()}
							sx={{ width: 76, height: 76, flexShrink: 0, borderRadius: "50%", border: `2px solid ${alpha(theme.palette.text.primary, 0.25)}`, bgcolor: alpha(theme.palette.text.primary, 0.08), color: theme.palette.text.primary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", p: 0, "&:active": { bgcolor: alpha(theme.palette.text.primary, 0.2) } }}
						>
							<ReplayRounded sx={{ fontSize: 44 }} />
						</Box>
					)}
				<Box
					sx={{
						color: alpha(theme.palette.text.primary, 0.75),
						transition: "transform 0.2s",
						transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
						flexShrink: 0,
						display: "flex",
					}}
				>
					<ExpandMoreRounded sx={{ fontSize: 40 }} />
				</Box>
			</Box>
			{junction && <Box component="img" src={junction.url} alt="Upcoming junction illustration" onError={(event: React.SyntheticEvent<HTMLImageElement>) => { event.currentTarget.style.display = "none"; }} sx={{ display: "block", maxWidth: "100%", maxHeight: 240, mx: "auto", borderRadius: 2 }} />}

			{/* Drops down beneath the trip card as an overlay: it neither pushes the
			    trip card (End stays put) nor covers the ETA and End button. */}
			<Collapse in={expanded} sx={{ position: "absolute", top: "calc(100% + var(--car-target, 112px) + 30px)", left: 0, right: 0 }}>
				<Box
					sx={(theme) => ({
						background: alpha(theme.palette.surface.main, 0.97),
						backdropFilter: "blur(10px)",
						borderRadius: "12px",
						border: `1px solid ${alpha(theme.palette.text.primary, 0.16)}`,
												boxShadow: "0 8px 24px rgba(0,0,0,0.58)",
					})}
				>
					{upcoming.length === 0 && (
						<Typography
							sx={{
								color: theme.palette.text.secondary,
								fontSize: 24,
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
											fontSize: 28,
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
									<Typography sx={{ color: "text.secondary", fontSize: 22, mt: 0.35 }}>
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
