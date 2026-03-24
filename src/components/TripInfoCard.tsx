import React from "react";
import { Box, Typography, Button, Divider } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import RouteIcon from "@mui/icons-material/Route";
import ScheduleIcon from "@mui/icons-material/Schedule";

interface Props {
	maneuvers: any[];
	currentStep: number;
	onEndNav: () => void;
}

function calcTripRemaining(maneuvers: any[], currentStep: number) {
	const remaining = maneuvers.slice(currentStep);
	const totalSecs = remaining.reduce((acc, m) => acc + (m.time ?? 0), 0);
	const totalKm = remaining.reduce((acc, m) => acc + (m.length ?? 0), 0);
	const now = new Date();
	const arrival = new Date(now.getTime() + totalSecs * 1000);
	const hrs = Math.floor(totalSecs / 3600);
	const mins = Math.round((totalSecs % 3600) / 60);
	const eta = arrival.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
	const duration = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
	const distance =
		totalKm >= 1
			? `${totalKm.toFixed(1)} km`
			: `${Math.round(totalKm * 1000)} m`;
	return { duration, distance, eta };
}

export default function TripInfoCard({
	maneuvers,
	currentStep,
	onEndNav,
}: Props) {
	if (maneuvers.length === 0) return null;
	const { duration, distance, eta } = calcTripRemaining(maneuvers, currentStep);
	const theme = useTheme();
	const statRows = [
		{ Icon: AccessTimeIcon, label: "TIME REMAINING", value: duration },
		{ Icon: ScheduleIcon, label: "ARRIVAL", value: eta },
		{ Icon: RouteIcon, label: "DISTANCE", value: distance },
	];

	return (
		<Box
			sx={(theme) => ({
				background: alpha(theme.palette.background.default, 0.85),
				backdropFilter: "blur(10px)",
				border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
				borderRadius: "14px",
				boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
				overflow: "hidden",
				width: 200,
			})}
		>
			<Box
				sx={{
					p: "14px 16px",
					display: "flex",
					flexDirection: "column",
					gap: 1.2,
				}}
			>
				{statRows.map(({ Icon, label, value }) => (
					<Box
						key={label}
						sx={{ display: "flex", alignItems: "center", gap: 1.2 }}
					>
						<Icon sx={{ color: theme.palette.primary.main, fontSize: 18 }} />
						<Box>
							<Typography
								sx={{
									color: theme.palette.text.secondary,
									fontSize: 10,
									lineHeight: 1,
								}}
							>
								{label}
							</Typography>
							<Typography
								sx={{
									color: theme.palette.text.primary,
									fontSize: 15,
									fontWeight: 700,
									lineHeight: 1.3,
								}}
							>
								{value}
							</Typography>
						</Box>
					</Box>
				))}
			</Box>
			<Divider /> {/* auto uses theme.palette.divider */}
			<Button
				onClick={onEndNav}
				fullWidth
				sx={(theme) => ({
					color: theme.palette.error.main,
					fontSize: 13,
					fontWeight: 600,
					py: 1.2,
					borderRadius: 0,
					letterSpacing: 0.3,
					"&:hover": { background: alpha(theme.palette.error.main, 0.12) },
				})}
			>
				End Navigation
			</Button>
		</Box>
	);
}
