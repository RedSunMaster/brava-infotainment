import React, { useState } from "react";
import { Box, Collapse, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { getManeuverIcon } from "../lib/maneuverIcon";
import { ExpandMoreRounded } from "@mui/icons-material";

interface Props {
	maneuvers: any[];
	currentStep: number;
}

export default function NavigationCard({ maneuvers, currentStep }: Props) {
	const [expanded, setExpanded] = useState(false);
	const theme = useTheme();
	const current = maneuvers[currentStep];
	const upcoming = maneuvers.slice(currentStep + 1, currentStep + 3);
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
					background: alpha(theme.palette.background.default, 0.85),
					backdropFilter: "blur(10px)",
					borderRadius: expanded ? "12px 12px 0 0" : "12px",
					padding: "16px 20px",
					display: "flex",
					alignItems: "center",
					gap: 2,
					boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
					border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
					transition: "border-radius 0.2s",
				})}
			>
				{/* Direction icon */}
				<Box
					sx={(theme) => ({
						width: 56,
						height: 56,
						borderRadius: "12px",
						background: theme.palette.primary.main,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						flexShrink: 0,
						boxShadow: `0 2px 8px ${alpha(theme.palette.primary.main, 0.5)}`,
					})}
				>
					<CurrentIcon sx={{ fontSize: 36, color: "common.white" }} />
				</Box>

				<Box sx={{ flex: 1, minWidth: 0 }}>
					<Typography
						sx={{
							color: theme.palette.text.primary,
							fontSize: 16,
							fontWeight: 600,
							lineHeight: 1.3,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{current.instruction}
					</Typography>
					<Typography
						sx={{ color: theme.palette.text.secondary, fontSize: 13, mt: 0.3 }}
					>
						{current.length?.toFixed(2)} km ·{" "}
						{Math.round((current.time ?? 0) / 60)} min
					</Typography>
				</Box>

				{/* Expand chevron */}
				<Box
					sx={{
						color: theme.palette.text.secondary,
						fontSize: 20,
						transition: "transform 0.2s",
						transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
						flexShrink: 0,
					}}
				>
					<ExpandMoreRounded />
				</Box>
			</Box>

			{/* Upcoming steps */}
			<Collapse in={expanded}>
				<Box
					sx={(theme) => ({
						background: alpha(theme.palette.background.default, 0.85),
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
									padding: "10px 16px",
									borderTop:
										i > 0
											? `1px solid ${alpha(theme.palette.text.primary, 0.05)}`
											: "none",
								})}
							>
								<Box
									sx={(theme) => ({
										width: 32,
										height: 32,
										borderRadius: "8px",
										background: alpha(theme.palette.primary.main, 0.2),
										border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										flexShrink: 0,
									})}
								>
									<StepIcon sx={{ fontSize: 20, color: "common.white" }} />
								</Box>
								<Box sx={{ flex: 1, minWidth: 0 }}>
									<Typography
										sx={(theme) => ({
											color: theme.palette.text.primary,
											fontSize: 13,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										})}
									>
										{m.instruction}
									</Typography>
									<Typography sx={{ color: "text.secondary", fontSize: 11 }}>
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
