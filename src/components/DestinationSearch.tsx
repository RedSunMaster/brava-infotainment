import React, { useEffect, useRef, useState } from "react";
import {
	Alert,
	Box,
	CircularProgress,
	InputBase,
	List,
	ListItemButton,
	Typography,
} from "@mui/material";
import { alpha, type Theme } from "@mui/material/styles";
import CloseRounded from "@mui/icons-material/CloseRounded";
import HistoryRounded from "@mui/icons-material/HistoryRounded";
import LocationOnRounded from "@mui/icons-material/LocationOnRounded";
import KeyboardHideRounded from "@mui/icons-material/KeyboardHideRounded";
import KeyboardRounded from "@mui/icons-material/KeyboardRounded";
import DriveButton from "./DriveButton";
import { stopCategoryLabel } from "../lib/stopCategories";
import { searchAlongRoute } from "../lib/routeSearch";
import { formatDetour, rankByDetour } from "../lib/stopDetours";
import { readFrequentPlaces } from "../lib/frequentPlaces";
import { readSavedPlaces } from "../lib/savedPlaces";
import HomeRounded from "@mui/icons-material/HomeRounded";
import WorkRounded from "@mui/icons-material/WorkRounded";
import { useKeyboard } from "../contexts/KeyboardContext";
import {
	resultDistanceKm,
	resolveLocation,
	searchLocations,
	type Coordinates,
	type LocationResult,
	type PlaceDetails,
} from "../lib/locationSearch";

interface Props {
	position: Coordinates;
	token: string;
	isNavActive: boolean;
	onSelect: (coords: Coordinates, name: string, buildingCoords?: Coordinates, details?: PlaceDetails) => Promise<void>;
	onClose: () => void;
	onCancelRouting: () => void;
	/** Overrides the heading, e.g. when choosing the Home or Work address. */
	title?: string;
	route?: Coordinates[];
	/** When given, the stop category is controlled from outside (the quick-stop icons). */
	category?: string | null;
	onCategoryChange?: (category: string | null) => void;
}

function formatDistance(item: LocationResult, position: Coordinates): string {
	const distance = resultDistanceKm(item, position);
	return distance == null
		? ""
		: distance < 1
			? `${Math.round(distance * 1000)} m`
			: `${distance.toFixed(1)} km`;
}

function readRecentSearches(): string[] {
	try {
		const saved: string[] = JSON.parse(
			localStorage.getItem("brava-recent-searches") ?? "[]",
		);
		return Array.isArray(saved)
			? saved
					.filter((query) => typeof query === "string" && query.trim())
					.slice(0, 5)
			: [];
	} catch {
		return [];
	}
}

// Panels opened from the top control row drop down directly beneath it, so the
// panel appears next to the button that opened it and never reaches the dock.
export const topSheetSx = {
	position: "absolute",
	top: "calc(100% + 12px)",
	left: 0,
	right: 0,
	bgcolor: (theme: Theme) => alpha(theme.palette.background.paper, 0.94),
	backdropFilter: "blur(12px)",
	borderRadius: 3,
	border: "1px solid",
	borderColor: "divider",
	boxShadow: 8,
	p: 2,
	zIndex: 30,
	boxSizing: "border-box",
} as const;

export default function DestinationSearch({
	position,
	token,
	isNavActive,
	onSelect,
	onClose,
	onCancelRouting,
	title,
	route,
	category: controlledCategory,
	onCategoryChange,
}: Props) {
	const { showKeyboard, hideKeyboard, isVisible } = useKeyboard();
	const [query, setQuery] = useState("");
	const [ownCategory, setOwnCategory] = useState<string | null>(null);
	const category = controlledCategory !== undefined ? controlledCategory : ownCategory;
	const setCategory = onCategoryChange ?? setOwnCategory;
	const [results, setResults] = useState<LocationResult[]>([]);
	const [recents, setRecents] = useState(readRecentSearches);
	const [frequent] = useState(readFrequentPlaces);
	const [saved] = useState(readSavedPlaces);
	const [status, setStatus] = useState<
		"idle" | "searching" | "ready" | "routing" | "error"
	>("idle");
	const [error, setError] = useState<string | null>(null);
	const [warning, setWarning] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const origin = useRef(position);
	const mounted = useRef(true);
	const session = useRef(crypto.randomUUID());
	const retrieval = useRef<AbortController | null>(null);
	const routing = useRef(false);
	const cancelRouting = useRef(onCancelRouting);
	cancelRouting.current = onCancelRouting;
	const cleanQuery = query.trim();
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			retrieval.current?.abort();
			if (routing.current) cancelRouting.current();
			hideKeyboard();
		};
	}, [hideKeyboard]);
	useEffect(() => {
		setResults([]);
		setError(null);
		setWarning(null);
		if (!category && cleanQuery.length < 3) {
			setStatus("idle");
			return;
		}
		setStatus("searching");
		const controller = new AbortController();
		const timer = window.setTimeout(async () => {
			try {
				if (category) {
					const found = await searchAlongRoute(category, route ?? [], origin.current, token, controller.signal);
					const destination = route?.[route.length - 1];
					const results = destination ? await rankByDetour(found, origin.current, destination, token, controller.signal) : found;
					if (!controller.signal.aborted) { setResults(results); setStatus("ready"); }
					return;
				}
				const response = await searchLocations(
					cleanQuery,
					origin.current,
					token,
					controller.signal,
					session.current,
				);
				if (controller.signal.aborted) return;
				setResults(response.results);
				setWarning(response.warning);
				setStatus("ready");
			} catch (cause) {
				if (controller.signal.aborted) return;
				setError(
					cause instanceof Error ? cause.message : "Search unavailable.",
				);
				setStatus("error");
			}
		}, 500);
		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	}, [cleanQuery, category, token, retry]);
	async function select(item: LocationResult) {
		if ((status !== "ready" && (status !== "idle" || cleanQuery || category)) || routing.current) return;
		routing.current = true;
		hideKeyboard();
		setStatus("routing");
		setError(null);
		try {
			retrieval.current = new AbortController();
			const { coords, buildingCoords, details } = await resolveLocation(
				item,
				token,
				retrieval.current.signal,
			);
			if (!mounted.current || retrieval.current.signal.aborted) return;
			if (item.source === "searchbox") session.current = crypto.randomUUID();
			await onSelect(coords, item.address ? `${item.name}, ${item.address}` : item.name, buildingCoords, details ?? { address: item.address, category: item.kind === "Business" ? undefined : item.kind });
			if (!mounted.current) return;
			const next = [
				cleanQuery,
				...recents.filter(
					(value) => value.toLowerCase() !== cleanQuery.toLowerCase(),
				),
			].filter(Boolean).slice(0, 5);
			setRecents(next);
			try {
				localStorage.setItem("brava-recent-searches", JSON.stringify(next));
			} catch {
				/* Navigation remains available if storage is full. */
			}
			routing.current = false;
			onClose();
		} catch (cause) {
			if (!mounted.current) return;
			setError(
				cause instanceof Error
					? cause.message
					: "Could not calculate this route.",
			);
			setStatus("ready");
			routing.current = false;
		}
	}
	function close() {
		retrieval.current?.abort();
		if (routing.current) {
			onCancelRouting();
			routing.current = false;
		}
		onClose();
	}
	function focusInput() {
		inputRef.current?.focus();
	}
	const busy = status === "searching" || status === "routing";
	return (
		<Box
			role="region"
			data-map-obstruction
			aria-label="Destination search"
			sx={{
				...topSheetSx,
				// With the keyboard away the sheet takes the room it freed, so more results show at once.
				height: isVisible ? (isNavActive ? "min(620px, 40vh)" : "min(820px, 45vh)") : (isNavActive ? "min(900px, 56vh)" : "min(1100px, 62vh)"),
				display: "flex",
				flexDirection: "column",
			}}
		>
			<Box
				sx={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 1,
				}}
			>
				<Box>
					<Typography sx={{ fontSize: 32, fontWeight: 800 }}>
						{title ?? (isNavActive ? "Add a stop" : "Where to?")}
					</Typography>
					{!isNavActive && <Typography sx={{ fontSize: 22, color: "text.secondary" }}>
						Search New Zealand
					</Typography>}
				</Box>
				<DriveButton aria-label="Close destination search" onClick={close}>
					<CloseRounded />
				</DriveButton>
			</Box>
			<Box sx={{ display: "flex", gap: 1, mt: 1, mb: 1 }}>
				<InputBase
					inputRef={inputRef}
					placeholder="Place, business or street address"
					value={query}
					disabled={status === "routing"}
					onChange={(event) => { setCategory(null); setQuery(event.target.value); }}
					onFocus={() => showKeyboard(hideKeyboard)}
					onClick={() => showKeyboard(hideKeyboard)}
					onKeyDown={(event) => {
						if (event.key === "Escape") close();
						if (event.key === "Enter") hideKeyboard();
					}}
					inputProps={{
						"aria-label": "Search destinations",
						inputMode: "none",
						maxLength: 256,
						"aria-controls": "destination-results",
					}}
					sx={{
						flex: 1,
						minWidth: 0,
						bgcolor: "background.default",
						border: "1px solid",
						borderColor: "divider",
						borderRadius: 2,
						p: isNavActive ? 1.5 : 2,
						fontSize: isNavActive ? 26 : 30,
						minHeight: isNavActive ? 72 : 96,
					}}
				/>
				{query && (
					<DriveButton
						disabled={status === "routing"}
						aria-label="Clear search"
						onClick={() => {
							setQuery("");
							focusInput();
						}}
					>
						<CloseRounded />
					</DriveButton>
				)}
				<DriveButton
					aria-label={isVisible ? "Hide keyboard" : "Show keyboard"}
					onClick={
						isVisible
							? hideKeyboard
							: () => {
									focusInput();
									showKeyboard(hideKeyboard);
								}
					}
				>
					{isVisible ? <KeyboardHideRounded /> : <KeyboardRounded />}
				</DriveButton>
			</Box>
			{category && <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><Typography sx={{ fontSize: 26, fontWeight: 700, flex: 1 }}>{stopCategoryLabel(category)} along your route{status === "ready" ? ` · ${results.length}` : ""}</Typography><DriveButton variant="outlined" aria-label="Clear stop category" onClick={() => setCategory(null)} sx={{ minWidth: 56, minHeight: 56, p: 0 }}><CloseRounded /></DriveButton></Box>}
			<Box
				role="status"
				aria-live="polite"
				sx={{
					minHeight: 42,
					display: category && status === "ready" ? "none" : "flex",
					alignItems: "center",
					gap: 2,
					flexShrink: 0,
				}}
			>
				{busy && <CircularProgress size={28} />}
				<Typography sx={{ fontSize: 24 }}>
					{status === "routing"
						? "Calculating route…"
						: status === "searching"
							? "Searching…"
							: (category || cleanQuery.length >= 3) && status === "ready"
								? `${results.length} results`
								: cleanQuery
									? "Type at least 3 characters"
									: "Saved and frequent places"}
				</Typography>
			</Box>
			{error && (
				<Alert
					severity="error"
					sx={{ fontSize: 22 }}
					action={
						<DriveButton onClick={() => setRetry((value) => value + 1)}>
							Retry
						</DriveButton>
					}
				>
					{error}
				</Alert>
			)}
			{warning && (
				<Alert severity="warning" sx={{ fontSize: 22 }}>
					{warning}
				</Alert>
			)}
			<Box
				sx={{
					overflowY: "auto",
					flex: 1,
					minHeight: 0,
					overscrollBehavior: "contain",
				}}
			>
				<List
					id="destination-results"
					aria-label={cleanQuery ? "Search results" : "Recent searches"}
					aria-busy={busy}
				>
					{results.map((item) => (
						<ListItemButton
							key={item.id}
							disabled={busy}
							onClick={() => void select(item)}
							sx={{
								minHeight: "var(--car-target)",
								gap: 2,
								py: 1,
								borderBottom: "1px solid",
								borderColor: "divider",
							}}
						>
							<LocationOnRounded sx={{ fontSize: 36, flexShrink: 0 }} />
							<Box sx={{ flex: 1, minWidth: 0 }}>
								<Typography noWrap sx={{ fontSize: 28, fontWeight: 700 }}>
									{item.name}
								</Typography>
								<Typography noWrap sx={{ fontSize: 22, color: "text.secondary" }}>
									{item.address.replace(/,? (\d{4},?)? ?New Zealand$/, "").replace(/ \d{4}$/, "")}
								</Typography>
								{!category && <Typography
									sx={{
										fontSize: 20,
										color: "text.secondary",
										textTransform: "capitalize",
									}}
								>
									{item.kind}
								</Typography>}
							</Box>
							<Box sx={{ textAlign: "right", whiteSpace: "nowrap" }}>
								{item.detourSeconds != null && <Typography sx={{ fontSize: 28, fontWeight: 800, color: item.detourSeconds < 45 ? "success.main" : "text.primary" }}>{formatDetour(item.detourSeconds)}</Typography>}
								<Typography sx={{ fontSize: item.detourSeconds != null ? 20 : 24, color: item.detourSeconds != null ? "text.secondary" : "inherit" }}>{formatDistance(item, origin.current)}</Typography>
							</Box>
						</ListItemButton>
					))}
					{!cleanQuery && !category && ([["home", "Home", HomeRounded], ["work", "Work", WorkRounded]] as const).map(([slot, label, Icon]) => {
						const place = saved[slot];
						return place ? (
							<ListItemButton key={slot} disabled={busy} onClick={() => void select({ id: slot, name: place.name, address: "", coords: place.coords, buildingCoords: place.buildingCoords, kind: label, source: "mapbox" })} sx={{ minHeight: "var(--car-target)", gap: 2 }}>
								<Icon sx={{ fontSize: 36 }} />
								<Box sx={{ minWidth: 0 }}><Typography noWrap sx={{ fontSize: 28, fontWeight: 700 }}>{label}</Typography><Typography noWrap sx={{ fontSize: 20, color: "text.secondary" }}>{place.name.split(",").slice(0, 2).join(",")}</Typography></Box>
							</ListItemButton>
						) : null;
					})}
					{!cleanQuery && !category && frequent.map((place) => (
						<ListItemButton key={place.name + place.coords.join(",")} disabled={busy} onClick={() => void select({ id: place.name, name: place.name, address: "", coords: place.coords, buildingCoords: place.buildingCoords, kind: "Frequent destination", source: "mapbox" })} sx={{ minHeight: "var(--car-target)", gap: 2 }}>
							<LocationOnRounded sx={{ fontSize: 36 }} />
							<Box sx={{ minWidth: 0 }}><Typography noWrap sx={{ fontSize: 28, fontWeight: 700 }}>{place.name.split(",")[0]}</Typography><Typography noWrap sx={{ fontSize: 20, color: "text.secondary" }}>{[place.name.split(",")[1]?.trim(), `${place.visits} ${place.visits === 1 ? "trip" : "trips"}`].filter(Boolean).join(" · ")}</Typography></Box>
						</ListItemButton>
					))}
					{!cleanQuery && !category && recents.length > 0 && <Typography sx={{ px: 2, pt: 2, fontSize: 22, color: "text.secondary" }}>Recent searches</Typography>}
					{!cleanQuery && !category &&
						recents.map((value) => (
							<ListItemButton
								key={value}
								onClick={() => {
									hideKeyboard();
									setQuery(value);
								}}
								sx={{ minHeight: "var(--car-target)", gap: 2 }}
							>
								<HistoryRounded sx={{ fontSize: 36 }} />
								<Typography sx={{ fontSize: 28 }}>{value}</Typography>
							</ListItemButton>
						))}
				</List>
				{!cleanQuery && !category && !recents.length && !frequent.length && (
					<Typography sx={{ p: 2, fontSize: 26 }}>
						Enter a place name or an address with its town.
					</Typography>
				)}
				{status === "ready" && !results.length && (
					<Typography sx={{ p: 2, fontSize: 26 }}>
						No matches. Add a town or try the street address.
					</Typography>
				)}
			</Box>
			{results.length > 0 && (
				<Typography sx={{ fontSize: 18, color: "text.secondary", pt: 1 }}>
					Mapbox · © OpenStreetMap contributors · Distances are straight-line
				</Typography>
			)}
		</Box>
	);
}
