import React from "react";
import { Box, Typography, Button } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import LocationOnIcon from "@mui/icons-material/LocationOn";

interface Props {
	placeName: string;
	duration: string;
	distance: string;
	confirmLabel?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

export default function ConfirmNavDialog({
	placeName,
	duration,
	distance,
	confirmLabel = "Take me there",
	onConfirm,
	onCancel,
}: Props) {
	const theme = useTheme();

	return (
		<Box
			sx={{
				background: alpha(theme.palette.surface.main, 0.98),
				backdropFilter: "blur(14px)",
				border: `1px solid ${alpha(theme.palette.text.primary, 0.18)}`,
				borderRadius: "16px",
				boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
				p: "16px 20px",
				width: 320,
				display: "flex",
				flexDirection: "column",
				gap: 1.5,
			}}
		>
			<Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
				<LocationOnIcon
					sx={{ color: theme.palette.primary.main, mt: "2px", fontSize: 20 }}
				/>
				<Box>
					<Typography
						sx={{
							color: theme.palette.text.primary,
							fontWeight: 600,
							fontSize: 15,
							lineHeight: 1.3,
						}}
					>
						{placeName}
					</Typography>
					<Typography sx={{ color: "text.secondary", fontSize: 12, mt: 0.3 }}>
						{duration}
						{" \u00B7 "}
						{distance}
					</Typography>
				</Box>
			</Box>

			<Box sx={{ display: "flex", gap: 1 }}>
				<Button
					onClick={onCancel}
					fullWidth
					sx={{
						background: alpha(theme.palette.text.primary, 0.1),
						color: theme.palette.text.primary,
						borderRadius: "10px",
						fontWeight: 600,
						fontSize: 13,
						py: 1,
						"&:hover": { background: alpha(theme.palette.text.primary, 0.14) },
					}}
				>
					Cancel
				</Button>
				<Button
					onClick={onConfirm}
					fullWidth
					sx={{
						background: theme.palette.primary.main,
						color: theme.palette.primary.contrastText,
						borderRadius: "10px",
						fontWeight: 600,
						fontSize: 13,
						py: 1,
						"&:hover": { background: theme.palette.primary.main },
					}}
				>
					{confirmLabel}
				</Button>
			</Box>
		</Box>
	);
}
