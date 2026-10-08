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
import {
	CloseRounded,
	HistoryRounded,
	LocationOnRounded,
	SearchRounded,
	KeyboardHideRounded,
} from "@mui/icons-material";
import DriveButton from "./DriveButton";
import { useKeyboard } from "../contexts/KeyboardContext";
import {
	resultDistanceKm,
	resolveLocation,
	searchLocations,
	type Coordinates,
	type LocationResult,
} from "../lib/locationSearch";

interface Props {
	position: Coordinates;
	token: string;
	isNavActive: boolean;
	onSelect: (coords: Coordinates, name: string) => Promise<void>;
	onClose: () => void;
	onCancelRouting: () => void;
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

export default function DestinationSearch({
	position,
	token,
	isNavActive,
	onSelect,
	onClose,
	onCancelRouting,
}: Props) {
	const { showKeyboard, hideKeyboard, isVisible } = useKeyboard();
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<LocationResult[]>([]);
	const [recents, setRecents] = useState(readRecentSearches);
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
		if (cleanQuery.length < 3) {
			setStatus("idle");
			return;
		}
		setStatus("searching");
		const controller = new AbortController();
		const timer = window.setTimeout(async () => {
			try {
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
	}, [cleanQuery, token, retry]);
	async function select(item: LocationResult) {
		if (status !== "ready" || routing.current) return;
		routing.current = true;
		hideKeyboard();
		setStatus("routing");
		setError(null);
		try {
			retrieval.current = new AbortController();
			const coords = await resolveLocation(
				item,
				token,
				retrieval.current.signal,
			);
			if (!mounted.current || retrieval.current.signal.aborted) return;
			if (item.source === "searchbox") session.current = crypto.randomUUID();
			await onSelect(coords, `${item.name}, ${item.address}`);
			if (!mounted.current) return;
			const next = [
				cleanQuery,
				...recents.filter(
					(value) => value.toLowerCase() !== cleanQuery.toLowerCase(),
				),
			].slice(0, 5);
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
			aria-label="Destination search"
			sx={{
				position: "fixed",
				left: 12,
				right: 12,
				bottom: isVisible
					? "calc(var(--vehicle-strip-height) + var(--keyboard-height))"
					: "var(--vehicle-strip-height)",
				height: isVisible
					? "min(960px, calc(100vh - var(--vehicle-strip-height) - var(--keyboard-height) - 24px))"
					: "min(960px, calc(100vh - var(--vehicle-strip-height) - 24px))",
				display: "flex",
				flexDirection: "column",
				bgcolor: "background.paper",
				borderRadius: "20px 20px 0 0",
				border: "1px solid",
				borderColor: "divider",
				p: 2,
				zIndex: 10001,
				boxSizing: "border-box",
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
						{isNavActive ? "Add a stop" : "Where to?"}
					</Typography>
					<Typography sx={{ fontSize: 22, color: "text.secondary" }}>
						Search New Zealand
					</Typography>
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
					onChange={(event) => setQuery(event.target.value)}
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
						p: 2,
						fontSize: 30,
						minHeight: 96,
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
					{isVisible ? <KeyboardHideRounded /> : <SearchRounded />}
				</DriveButton>
			</Box>
			<Box
				role="status"
				aria-live="polite"
				sx={{
					minHeight: 42,
					display: "flex",
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
							: cleanQuery.length >= 3 && status === "ready"
								? `${results.length} results`
								: cleanQuery
									? "Type at least 3 characters"
									: "Recent searches"}
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
								py: 2,
								borderBottom: "1px solid",
								borderColor: "divider",
							}}
						>
							<LocationOnRounded sx={{ fontSize: 36, flexShrink: 0 }} />
							<Box sx={{ flex: 1, minWidth: 0 }}>
								<Typography sx={{ fontSize: 28, fontWeight: 700 }}>
									{item.name}
								</Typography>
								<Typography sx={{ fontSize: 22, color: "text.secondary" }}>
									{item.address}
								</Typography>
								<Typography
									sx={{
										fontSize: 20,
										color: "text.secondary",
										textTransform: "capitalize",
									}}
								>
									{item.kind}
								</Typography>
							</Box>
							<Typography sx={{ fontSize: 24, whiteSpace: "nowrap" }}>
								{formatDistance(item, origin.current)}
							</Typography>
						</ListItemButton>
					))}
					{!cleanQuery &&
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
				{!cleanQuery && !recents.length && (
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
