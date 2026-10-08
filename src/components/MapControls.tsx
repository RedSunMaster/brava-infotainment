import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import {
	CloseRounded,
	ExploreRounded,
	MyLocationRounded,
	RouteRounded,
	SearchRounded,
	SettingsRounded,
} from "@mui/icons-material";
import { ipcRenderer } from "electron";
import type { CameraMode, Orientation, RoutingProvider } from "../constants";
import { useThemeMode } from "../ThemeContext";
import { useKeyboard } from "../contexts/KeyboardContext";
import DriveButton from "./DriveButton";
import DestinationSearch from "./DestinationSearch";

interface Props {
	cameraMode: CameraMode;
	orientation: Orientation;
	hasRoute: boolean;
	currentBearing: number;
	currentPosition: [number, number];
	mapboxToken: string;
	onOverview: () => void;
	onToggleOrientation: () => void;
	onSearchSelect: (
		coords: [number, number],
		placeName: string,
	) => Promise<void>;
	onCancelRouting: () => void;
	isNavActive: boolean;
	onLocate: () => void;
	provider: RoutingProvider;
	onToggleProvider: () => void;
	isDriving: boolean;
}
export default function MapControls({
	orientation,
	hasRoute,
	currentPosition,
	mapboxToken,
	onOverview,
	onToggleOrientation,
	onSearchSelect,
	onCancelRouting,
	isNavActive,
	onLocate,
	provider,
	onToggleProvider,
	isDriving,
}: Props) {
	const { hideKeyboard } = useKeyboard();
	const { preference, setPreference, reason } = useThemeMode();
	const [panel, setPanel] = useState<"search" | "settings" | null>(null);
	function close() {
		setPanel(null);
		hideKeyboard();
	}
	useEffect(() => {
		if (isDriving) {
			setPanel(null);
			hideKeyboard();
		}
	}, [isDriving, hideKeyboard]);
	return (
		<>
			<Box sx={{ display: "flex", gap: 1, flex: 1, minWidth: 0 }}>
				<DriveButton
					disabled={isDriving}
					aria-label={isNavActive ? "Add a stop" : "Choose destination"}
					onClick={() => {
						setPanel("search");
					}}
					sx={{ flex: 1 }}
				>
					<SearchRounded />
					<Box component="span" sx={{ ml: 1 }}>
						{isNavActive ? "Stop" : "Go"}
					</Box>
				</DriveButton>
				<DriveButton aria-label="Centre on location" onClick={onLocate}>
					<MyLocationRounded />
				</DriveButton>
				{hasRoute && (
					<DriveButton aria-label="Route overview" onClick={onOverview}>
						<RouteRounded />
					</DriveButton>
				)}
				<DriveButton
					aria-label={
						orientation === "heading"
							? "Switch to north up"
							: "Switch to heading up"
					}
					onClick={onToggleOrientation}
				>
					<ExploreRounded />
				</DriveButton>
				<DriveButton
					disabled={isDriving}
					aria-label="Open settings"
					onClick={() => setPanel("settings")}
				>
					<SettingsRounded />
				</DriveButton>
			</Box>
			{panel === "search" && (
				<DestinationSearch
					position={currentPosition}
					token={mapboxToken}
					isNavActive={isNavActive}
					onSelect={onSearchSelect}
					onClose={close}
					onCancelRouting={onCancelRouting}
				/>
			)}
			{panel === "settings" && (
				<Box
					role="region"
					aria-label="Settings"
					sx={{
						position: "fixed",
						left: 12,
						right: 12,
						bottom: "var(--vehicle-strip-height)",
						bgcolor: "background.paper",
						borderRadius: "20px 20px 0 0",
						border: "1px solid",
						borderColor: "divider",
						p: 2,
						zIndex: 10001,
					}}
				>
					<Box
						sx={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							mb: 1,
						}}
					>
						<Typography sx={{ fontSize: 32, fontWeight: 800 }}>
							Settings
						</Typography>
						<DriveButton aria-label="Close panel" onClick={close}>
							<CloseRounded />
						</DriveButton>
					</Box>
					<Box sx={{ display: "grid", gap: 2 }}>
						<Typography sx={{ fontSize: 24 }}>Appearance · {reason}</Typography>
						<Box
							role="group"
							aria-label="Appearance"
							sx={{ display: "flex", gap: 1 }}
						>
							{(["auto", "light", "dark"] as const).map((value) => (
								<DriveButton
									key={value}
									sx={{ flex: 1 }}
									variant={preference === value ? "contained" : "outlined"}
									aria-pressed={preference === value}
									onClick={() => setPreference(value)}
								>
									{value === "auto"
										? "Auto"
										: value === "light"
											? "Day"
											: "Night"}
								</DriveButton>
							))}
						</Box>
						<DriveButton variant="outlined" onClick={onToggleProvider}>
							Routing:{" "}
							{provider === "mapbox" ? "Mapbox online" : "Valhalla local"}
						</DriveButton>
						<Typography sx={{ fontSize: 24, color: "text.secondary" }}>
							Local routing requires the Valhalla service. Place search still
							needs internet.
						</Typography>
						<DriveButton
							color="error"
							onClick={() => ipcRenderer.send("app-quit")}
						>
							Exit app
						</DriveButton>
					</Box>
				</Box>
			)}
		</>
	);
}
