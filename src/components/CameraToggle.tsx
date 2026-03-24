import React from "react";
import { Box, IconButton, Tooltip } from "@mui/material";
import type { CameraMode } from "../constants";

interface Props {
	mode: CameraMode;
	onOverview: () => void;
	onFollowing: () => void;
}

export default function CameraToggle({ mode, onOverview, onFollowing }: Props) {
	return (
		<Box
			sx={{
				position: "absolute",
				bottom: 16,
				right: 16,
				zIndex: 10,
				display: "flex",
				gap: 1,
			}}
		>
			<Tooltip title="Overview">
				<IconButton
					onClick={onOverview}
					sx={{
						background: mode === "overview" ? "#3b82f6" : "#1e1e1ecc",
						color: "white",
						backdropFilter: "blur(4px)",
						"&:hover": { background: "#3b82f6" },
						width: 44,
						height: 44,
						fontSize: 20,
					}}
				>
					🗺
				</IconButton>
			</Tooltip>
			<Tooltip title="Follow">
				<IconButton
					onClick={onFollowing}
					sx={{
						background: mode === "following" ? "#3b82f6" : "#1e1e1ecc",
						color: "white",
						backdropFilter: "blur(4px)",
						"&:hover": { background: "#3b82f6" },
						width: 44,
						height: 44,
						fontSize: 20,
					}}
				>
					🧭
				</IconButton>
			</Tooltip>
		</Box>
	);
}
