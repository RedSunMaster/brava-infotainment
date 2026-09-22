import React, { useState, useRef, useEffect } from "react";
import {
	Box,
	Divider,
	IconButton,
	InputBase,
	Popover,
	Tooltip,
	List,
	ListItemButton,
	ListItemText,
	CircularProgress,
	Typography,
} from "@mui/material";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import type { CameraMode, Orientation, RoutingProvider } from "../constants";
import {
	CloseRounded,
	DarkModeRounded,
	ExploreOffRounded,
	ExploreRounded,
	LightModeRounded,
	MyLocationRounded,
	RouteRounded,
	SearchRounded,
	SettingsRounded,
} from "@mui/icons-material";
import { useThemeMode } from "../ThemeContext";
import { useKeyboard } from "../contexts/KeyboardContext";

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
	isDriving: boolean;
}

function iconBtnStyle(active: boolean, theme: Theme) {
	return {
		width: 58,
		height: 58,
		background: active
			? theme.palette.primary.main
			: alpha(theme.palette.surface.main, 0.96),
		backdropFilter: "blur(10px)",
		border: `1px solid ${
			active
				? alpha(theme.palette.primary.main, 0.9)
				: alpha(theme.palette.text.primary, 0.22)
		}`,
		borderRadius: "10px",
		color: active ? theme.palette.primary.contrastText : theme.palette.text.primary,
		boxShadow: active
			? `0 4px 18px ${alpha(theme.palette.primary.main, 0.35)}`
			: "0 4px 14px rgba(0,0,0,0.58)",
		"&:hover": {
			background: active
				? theme.palette.primary.main
				: alpha(theme.palette.background.paper, 0.98),
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
	isDriving,
}: Props) {
	const theme = useTheme();
	const { showKeyboard, hideKeyboard } = useKeyboard();
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<Suggestion[]>([]);
	const [loading, setLoading] = useState(false);
	const [dropdownOpen, setDropdownOpen] = useState(false);
	const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(
		null,
	);
	const [searchExpanded, setSearchExpanded] = useState(false);

	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const sessionTokenRef = useRef<string>(
		Math.random().toString(36).slice(2) + Date.now().toString(36),
	);
	const { mode, toggleMode } = useThemeMode();

	const settingsOpen = Boolean(settingsAnchor);

	useEffect(() => {
		if (!isNavActive) setSearchExpanded(false);
	}, [isNavActive]);

	useEffect(() => {
		if (isDriving) setSettingsAnchor(null);
	}, [isDriving]);

	function handleExitApp() {
		if (isDriving) return;
		if (!window.confirm("Exit the infotainment app?")) return;
		const ipcRenderer = (window as any).require?.("electron")?.ipcRenderer;
		if (ipcRenderer) {
			ipcRenderer.send("app-quit");
		} else if (document.exitFullscreen) {
			document.exitFullscreen();
		} else if ((document as any).webkitExitFullscreen) {
			(document as any).webkitExitFullscreen();
		}
		window.close();
	}

	useEffect(() => {
		if (isDriving && isNavActive) {
			setSearchExpanded(false);
			setDropdownOpen(false);
			return;
		}
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
	}, [query, mapboxToken, currentPosition, isDriving, isNavActive]);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (
				wrapperRef.current &&
				!wrapperRef.current.contains(e.target as Node)
			) {
				setDropdownOpen(false);
				if (isNavActive && query === "") setSearchExpanded(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [isNavActive, query]);

	async function handleSelect(suggestion: Suggestion) {
		setDropdownOpen(false);
		setQuery("");
		setSearchExpanded(false);
		hideKeyboard();
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

	const searchLocked = isDriving && isNavActive;
	const showFullSearch = !isNavActive || searchExpanded;

	return (
		<Box
			ref={wrapperRef}
			sx={{
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-end",
				gap: 1,
				width: showFullSearch ? "100%" : "auto",
			}}
		>
			{showFullSearch && !searchLocked ? (
				<Box sx={{ position: "relative", width: "100%" }}>
					<InputBase
						autoFocus={searchExpanded}
						placeholder={
							searchLocked ? "Search unavailable while driving" : "Search places..."
						}
						value={query}
						onChange={(e) => {
							if (!searchLocked) setQuery(e.target.value);
						}}
						disabled={searchLocked}
						inputProps={{ inputMode: "none", enterKeyHint: "search" }}
						onFocus={() => showKeyboard()}
						onClick={() => showKeyboard()}
						onTouchStart={(e) => {
							e.currentTarget.querySelector("input")?.focus();
						}}
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
							background: alpha(theme.palette.surface.main, 0.96),
							backdropFilter: "blur(10px)",
							border: `1px solid ${alpha(theme.palette.text.primary, 0.22)}`,
							borderRadius: "10px",
							px: 1.5,
							py: 0.75,
							color: "text.primary",
							boxShadow: "0 4px 16px rgba(0,0,0,0.55)",
							fontSize: 14,
							minHeight: 56,
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
								background: alpha(theme.palette.surface.main, 0.98),
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
									onMouseDown={(e) => e.preventDefault()}
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
			) : !searchLocked ? (
				<Tooltip title="Search" placement="bottom">
					<IconButton
						onClick={() => {
							if (!searchLocked) setSearchExpanded(true);
						}}
						disabled={searchLocked}
						sx={iconBtnStyle(false, theme)}
						aria-label="Open search"
					>
						<SearchRounded fontSize="small" />
					</IconButton>
				</Tooltip>
			) : null}

			{/* Icon button row */}
			<Box
				sx={{
					display: "flex",
					flexDirection: isNavActive ? "column" : "row",
					flexWrap: "wrap",
					gap: 1,
					justifyContent: "flex-end",
					alignItems: "flex-end",
				}}
			>
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
						<IconButton
							onClick={onLocate}
							sx={iconBtnStyle(false, theme)}
							aria-label="Centre on location"
						>
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
						aria-label="Toggle map orientation"
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

				{!isDriving && (
					<Tooltip title="Settings" placement="bottom">
						<IconButton
							onClick={(e) => setSettingsAnchor(e.currentTarget)}
							sx={iconBtnStyle(settingsOpen, theme)}
							aria-label="Settings"
						>
							<SettingsRounded fontSize="small" />
						</IconButton>
					</Tooltip>
				)}

				<Popover
					open={settingsOpen}
					anchorEl={settingsAnchor}
					onClose={() => setSettingsAnchor(null)}
					anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
					transformOrigin={{ vertical: "top", horizontal: "right" }}
					slotProps={{
						paper: {
							sx: {
								mt: 0.75,
								minWidth: 220,
								background: alpha(theme.palette.surface.main, 0.98),
								backdropFilter: "blur(14px)",
								border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
								borderRadius: "12px",
								boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
								overflow: "hidden",
							},
						},
					}}
				>
					<Box
						onClick={() => {
							toggleMode();
							setSettingsAnchor(null);
						}}
						sx={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							px: 2,
							py: 1.5,
							cursor: "pointer",
							"&:hover": {
								background: alpha(theme.palette.text.primary, 0.06),
							},
						}}
					>
						<Typography
							sx={{ fontSize: 13, color: theme.palette.text.primary }}
						>
							{mode === "dark" ? "Light mode" : "Dark mode"}
						</Typography>
						{mode === "dark" ? (
							<LightModeRounded
								fontSize="small"
								sx={{ color: theme.palette.text.secondary }}
							/>
						) : (
							<DarkModeRounded
								fontSize="small"
								sx={{ color: theme.palette.text.secondary }}
							/>
						)}
					</Box>

					<Divider
						sx={{ borderColor: alpha(theme.palette.text.primary, 0.08) }}
					/>

					<Box
						onClick={() => {
							if (!isDriving) onToggleProvider();
						}}
						sx={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							px: 2,
							py: 1.5,
							cursor: isDriving ? "not-allowed" : "pointer",
							opacity: isDriving ? 0.45 : 1,
							"&:hover": {
								background: alpha(theme.palette.text.primary, 0.06),
							},
						}}
					>
						<Typography
							sx={{ fontSize: 13, color: theme.palette.text.primary }}
						>
							Routing
						</Typography>
						<Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
							<Typography
								sx={{
									fontSize: 11,
									fontWeight: 700,
									letterSpacing: "0.04em",
									color:
										provider === "mapbox"
											? theme.palette.primary.main
											: theme.palette.text.secondary,
								}}
							>
								{provider === "mapbox" ? "ONLINE" : "OFFLINE"}
							</Typography>
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
					</Box>

					<Divider
						sx={{ borderColor: alpha(theme.palette.text.primary, 0.08) }}
					/>

					<Box
						onClick={handleExitApp}
						sx={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							px: 2,
							py: 1.5,
							cursor: isDriving ? "not-allowed" : "pointer",
							opacity: isDriving ? 0.45 : 1,
							"&:hover": {
								background: alpha(theme.palette.error.main, 0.12),
							},
						}}
					>
						<Typography
							sx={{
								fontSize: 13,
								color: theme.palette.error.main,
								fontWeight: 600,
							}}
						>
							Exit app
						</Typography>
						<CloseRounded
							fontSize="small"
							sx={{ color: theme.palette.error.main }}
						/>
					</Box>
				</Popover>
			</Box>
		</Box>
	);
}
