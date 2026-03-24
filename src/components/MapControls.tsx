import React, { useState, useRef, useEffect } from "react";
import {
	Box,
	IconButton,
	InputBase,
	Tooltip,
	List,
	ListItemButton,
	ListItemText,
	CircularProgress,
} from "@mui/material";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import type { CameraMode, Orientation, RoutingProvider } from "../constants";
import {
	DarkModeRounded,
	ExploreOffRounded,
	ExploreRounded,
	LightModeRounded,
	MyLocationRounded,
	RouteRounded,
	SearchRounded,
} from "@mui/icons-material";
import { useThemeMode } from "../ThemeContext";

interface Suggestion {
	mapbox_id: string;
	name: string;
	place_formatted: string;
	full_address?: string;
	feature_type: string;
}

interface Props {
	cameraMode: CameraMode;
	orientation: Orientation;
	hasRoute: boolean;
	currentBearing: number;
	currentPosition: [number, number];
	mapboxToken: string;
	onOverview: () => void;
	onToggleOrientation: () => void;
	onSearchSelect: (coords: [number, number], placeName: string) => void;
	isNavActive: boolean;
	onLocate: () => void;
	provider: RoutingProvider;
	onToggleProvider: () => void;
}

// Accepts theme so it can reference palette tokens
function iconBtnStyle(active: boolean, theme: Theme) {
	return {
		width: 44,
		height: 44,
		background: active
			? theme.palette.primary.main
			: alpha(theme.palette.background.default, 0.85),
		backdropFilter: "blur(10px)",
		border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
		borderRadius: "10px",
		color: active ? theme.palette.common.white : theme.palette.text.primary,
		boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
		"&:hover": {
			background: active
				? theme.palette.primary.dark
				: alpha(theme.palette.background.paper, 0.9),
		},
		"&:disabled": { opacity: 0.3 },
	};
}

export default function MapControls({
	cameraMode,
	orientation,
	hasRoute,
	currentBearing,
	currentPosition,
	mapboxToken,
	onOverview,
	onToggleOrientation,
	onSearchSelect,
	isNavActive,
	onLocate,
	provider,
	onToggleProvider,
}: Props) {
	const theme = useTheme();
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<Suggestion[]>([]);
	const [loading, setLoading] = useState(false);
	const [dropdownOpen, setDropdownOpen] = useState(false);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const sessionTokenRef = useRef<string>(
		Math.random().toString(36).slice(2) + Date.now().toString(36),
	);
	const { mode, toggleMode } = useThemeMode();

	useEffect(() => {
		if (!query.trim()) {
			setResults([]);
			setDropdownOpen(false);
			return;
		}
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(async () => {
			setLoading(true);
			try {
				const [lng, lat] = currentPosition;
				const url =
					`https://api.mapbox.com/search/searchbox/v1/suggest` +
					`?q=${encodeURIComponent(query)}&proximity=${lng},${lat}&limit=6&language=en` +
					`&session_token=${sessionTokenRef.current}&access_token=${mapboxToken}`;
				const res = await fetch(url);
				const data = await res.json();
				setResults(data.suggestions ?? []);
				setDropdownOpen(true);
			} finally {
				setLoading(false);
			}
		}, 300);
	}, [query, mapboxToken]);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node))
				setDropdownOpen(false);
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	async function handleSelect(suggestion: Suggestion) {
		setDropdownOpen(false);
		setQuery("");
		setLoading(true);
		try {
			const url =
				`https://api.mapbox.com/search/searchbox/v1/retrieve/${suggestion.mapbox_id}` +
				`?session_token=${sessionTokenRef.current}&access_token=${mapboxToken}`;
			const res = await fetch(url);
			const data = await res.json();
			const feature = data.features?.[0];
			if (!feature) return;
			onSearchSelect(feature.geometry.coordinates, suggestion.name);
			sessionTokenRef.current =
				Math.random().toString(36).slice(2) + Date.now().toString(36);
		} finally {
			setLoading(false);
		}
	}

	return (
		<Box
			ref={wrapperRef}
			sx={{
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-end",
				gap: 1,
				width: "100%",
			}}
		>
			{/* Search bar */}
			<Box sx={{ position: "relative", width: "100%" }}>
				<InputBase
					placeholder="Search places..."
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					inputProps={{ inputMode: "search" }}
					onTouchStart={(e) =>
						(
							e.currentTarget.querySelector("input") as HTMLInputElement
						)?.focus()
					}
					startAdornment={
						<SearchRounded
							sx={{
								color: theme.palette.text.secondary,
								fontSize: 18,
								mr: 1,
								flexShrink: 0,
							}}
						/>
					}
					endAdornment={
						loading && (
							<CircularProgress
								size={14}
								sx={{ color: theme.palette.text.secondary, mr: 1 }}
							/>
						)
					}
					sx={{
						width: "100%",
						background: alpha(theme.palette.background.default, 0.85),
						backdropFilter: "blur(10px)",
						border: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
						borderRadius: "10px",
						px: 1.5,
						py: 0.75,
						color: "text.primary",
						boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
						fontSize: 14,
						"& input::placeholder": { color: theme.palette.text.secondary },
					}}
				/>

				{dropdownOpen && results.length > 0 && (
					<List
						sx={{
							position: "absolute",
							top: "calc(100% + 6px)",
							right: 0,
							width: "100%",
							background: alpha(theme.palette.background.default, 0.95),
							backdropFilter: "blur(14px)",
							border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
							borderRadius: "10px",
							boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
							py: 0.5,
							zIndex: 30,
							maxHeight: 280,
							overflowY: "auto",
						}}
					>
						{results.map((s) => (
							<ListItemButton
								key={s.mapbox_id}
								onClick={() => handleSelect(s)}
								sx={{
									borderRadius: "6px",
									mx: 0.5,
									"&:hover": {
										background: alpha(theme.palette.primary.main, 0.15),
									},
								}}
							>
								<ListItemText
									primary={s.name}
									secondary={s.place_formatted}
									primaryTypographyProps={{
										sx: {
											color: theme.palette.text.primary,
											fontSize: 13,
											fontWeight: 600,
										},
									}}
									secondaryTypographyProps={{
										sx: { color: "text.secondary", fontSize: 11 },
									}}
								/>
							</ListItemButton>
						))}
					</List>
				)}
			</Box>

			{/* Icon buttons */}
			<Box sx={{ display: "flex", gap: 1 }}>
				{isNavActive && (
					<Tooltip title="Route overview" placement="bottom">
						<span>
							<IconButton
								onClick={onOverview}
								disabled={!hasRoute}
								sx={iconBtnStyle(cameraMode === "overview", theme)}
							>
								<RouteRounded fontSize="small" />
							</IconButton>
						</span>
					</Tooltip>
				)}

				{cameraMode !== "following" && (
					<Tooltip title="Centre on location" placement="bottom">
						<IconButton onClick={onLocate} sx={iconBtnStyle(false, theme)}>
							<MyLocationRounded fontSize="small" />
						</IconButton>
					</Tooltip>
				)}

				<Tooltip
					title={
						orientation === "heading"
							? "Switch to north up"
							: "Switch to heading up"
					}
					placement="bottom"
				>
					<IconButton
						onClick={onToggleOrientation}
						sx={{
							...iconBtnStyle(false, theme),
							transform: `rotate(${-currentBearing}deg)`,
							transition: "transform 0.3s ease, background 0.2s",
						}}
					>
						{orientation === "heading" ? (
							<ExploreRounded fontSize="small" />
						) : (
							<ExploreOffRounded fontSize="small" />
						)}
					</IconButton>
				</Tooltip>

				{/* Online/Offline toggle */}
				<Tooltip
					title={
						provider === "mapbox"
							? "Switch to offline (Valhalla)"
							: "Switch to online (Mapbox)"
					}
					placement="bottom"
				>
					<Box
						onClick={onToggleProvider}
						sx={{
							display: "flex",
							alignItems: "center",
							gap: 0.75,
							height: 44,
							px: 1.5,
							background: alpha(theme.palette.background.default, 0.85),
							backdropFilter: "blur(10px)",
							border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
							borderRadius: "10px",
							cursor: "pointer",
							userSelect: "none",
							boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
							"&:hover": {
								background: alpha(theme.palette.background.paper, 0.9),
							},
						}}
					>
						<Box
							sx={{
								fontSize: 11,
								fontWeight: 700,
								color:
									provider === "mapbox"
										? theme.palette.primary.main
										: theme.palette.text.secondary,
								letterSpacing: "0.04em",
							}}
						>
							{provider === "mapbox" ? "ONLINE" : "OFFLINE"}
						</Box>

						{/* Track */}
						<Box
							sx={{
								position: "relative",
								width: 32,
								height: 18,
								borderRadius: "9px",
								background:
									provider === "mapbox"
										? theme.palette.primary.main
										: theme.palette.action.disabled,
								transition: "background 0.25s ease",
								flexShrink: 0,
							}}
						>
							{/* Thumb */}
							<Box
								sx={{
									position: "absolute",
									top: 2,
									left: provider === "mapbox" ? 16 : 2,
									width: 14,
									height: 14,
									borderRadius: "50%",
									background: theme.palette.common.white,
									transition: "left 0.25s ease",
									boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
								}}
							/>
						</Box>
					</Box>
				</Tooltip>
				<Tooltip
					title={
						mode === "dark" ? "Switch to light mode" : "Switch to dark mode"
					}
					placement="bottom"
				>
					<IconButton onClick={toggleMode} sx={iconBtnStyle(false, theme)}>
						{mode === "dark" ? (
							<LightModeRounded fontSize="small" />
						) : (
							<DarkModeRounded fontSize="small" />
						)}
					</IconButton>
				</Tooltip>
			</Box>
		</Box>
	);
}
