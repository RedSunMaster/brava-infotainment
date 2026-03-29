import React, { useState } from "react";
import { Box, Collapse, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { getManeuverIcon } from "../lib/maneuverIcon";
import { ExpandMoreRounded } from "@mui/icons-material";

interface Props {
	maneuvers: any[];
	currentStep: number;
	distanceToNextM?: number | null; // ← new
	timeToNextS?: number | null; // ← new
}

export default function NavigationCard({
	maneuvers,
	currentStep,
	distanceToNextM,
	timeToNextS,
}: Props) {
	const [expanded, setExpanded] = useState(false);
	const theme = useTheme();
	const current = maneuvers[currentStep + 1];
	const upcoming = maneuvers.slice(currentStep + 2, currentStep + 4);
	if (!current) return null;
	const CurrentIcon = getManeuverIcon(current);

	return (
		<Box
			onClick={() => setExpanded((e) => !e)}
			sx={{ cursor: "pointer", userSelect: "none" }}
		>
			{/* Current step */}
			<Box
				sx={(theme) => ({
					background: alpha(theme.palette.background.default, 0.92),
					backdropFilter: "blur(10px)",
					borderRadius: expanded ? "12px 12px 0 0" : "12px",
					padding: "12px 14px",
					display: "flex",
					alignItems: "center",
					gap: 1.5,
					boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
					border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
					transition: "border-radius 0.2s",
				})}
			>
				{/* Direction icon — reduced from 56×56 / fontSize 36 */}
				<Box
					sx={(theme) => ({
						width: 44,
						height: 44,
						borderRadius: "10px",
						background: theme.palette.primary.main,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						flexShrink: 0,
						boxShadow: `0 2px 8px ${alpha(theme.palette.primary.main, 0.5)}`,
					})}
				>
					<CurrentIcon sx={{ fontSize: 26, color: "common.white" }} />
				</Box>

				<Box sx={{ flex: 1, minWidth: 0 }}>
					{/* Allow wrapping so long street names are never hidden */}
					<Typography
						sx={{
							color: theme.palette.text.primary,
							fontSize: 15,
							fontWeight: 700,
							lineHeight: 1.25,
							wordBreak: "break-word",
							whiteSpace: "normal",
						}}
					>
						{current.instruction}
					</Typography>
					<Typography
						sx={{
							color: theme.palette.text.secondary,
							fontSize: 13,
							fontWeight: 500,
							mt: 0.4,
						}}
					>
						{distanceToNextM != null
							? distanceToNextM >= 1000
								? `${(distanceToNextM / 1000).toFixed(1)} km`
								: `${Math.round(distanceToNextM)} m`
							: `${current.length?.toFixed(2)} km`}
						{" \u00B7 "}
						{timeToNextS != null
							? timeToNextS >= 3600
								? `${Math.floor(timeToNextS / 3600)}h ${Math.round((timeToNextS % 3600) / 60)}m`
								: `${Math.ceil(timeToNextS / 60)} min`
							: `${Math.round((current.time ?? 0) / 60)} min`}
					</Typography>
				</Box>

				{/* Expand chevron */}
				<Box
					sx={{
						color: theme.palette.text.secondary,
						transition: "transform 0.2s",
						transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
						flexShrink: 0,
						display: "flex",
					}}
				>
					<ExpandMoreRounded />
				</Box>
			</Box>

			{/* Upcoming steps */}
			<Collapse in={expanded}>
				<Box
					sx={(theme) => ({
						background: alpha(theme.palette.background.default, 0.92),
						backdropFilter: "blur(10px)",
						borderRadius: "0 0 12px 12px",
						border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
						borderTopWidth: 0,
						boxShadow: "0 8px 20px rgba(0,0,0,0.4)",
					})}
				>
					{upcoming.length === 0 && (
						<Typography
							sx={(theme) => ({
								color: theme.palette.text.secondary,
								fontSize: 12,
								p: "10px 16px",
							})}
						>
							No further steps
						</Typography>
					)}
					{upcoming.map((m, i) => {
						const StepIcon = getManeuverIcon(m);
						return (
							<Box
								key={i}
								sx={(theme) => ({
									display: "flex",
									alignItems: "center",
									gap: 1.5,
									padding: "10px 14px",
									borderTop:
										i > 0
											? `1px solid ${alpha(theme.palette.text.primary, 0.05)}`
											: "none",
								})}
							>
								<Box
									sx={(theme) => ({
										width: 30,
										height: 30,
										borderRadius: "8px",
										background: alpha(theme.palette.primary.main, 0.2),
										border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										flexShrink: 0,
									})}
								>
									<StepIcon sx={{ fontSize: 18, color: "common.white" }} />
								</Box>
								<Box sx={{ flex: 1, minWidth: 0 }}>
									<Typography
										sx={(theme) => ({
											color: theme.palette.text.primary,
											fontSize: 13,
											fontWeight: 500,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										})}
									>
										{m.instruction}
									</Typography>
									<Typography
										sx={{ color: "text.secondary", fontSize: 11, mt: 0.25 }}
									>
										{m.length?.toFixed(2)} km
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
