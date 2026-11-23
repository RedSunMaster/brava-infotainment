import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import DriveButton from "./DriveButton";
import type { ExploreStats } from "../hooks/useExploration";
import type { LngLat } from "../lib/exploration";

const KIND_NAME = { place: "Town or city", locality: "Suburb", neighborhood: "Neighbourhood", area: "Area" } as const;
/** How many discoveries are listed before "Show all". */
const RECENT = 5;
const PLURAL = { place: ["town or city", "towns or cities"], locality: ["suburb", "suburbs"], neighborhood: ["neighbourhood", "neighbourhoods"], area: ["area", "areas"] } as const;

/** "8 places: 5 suburbs, 1 town or city, 2 areas", biggest kinds first. */
function placeSummary(places: ExploreStats["places"]): string {
	const counts = new Map<keyof typeof PLURAL, number>();
	for (const place of places) counts.set(place.kind, (counts.get(place.kind) ?? 0) + 1);
	const parts = (["place", "locality", "neighborhood", "area"] as const).filter(kind => counts.get(kind)).map(kind => `${counts.get(kind)} ${PLURAL[kind][counts.get(kind) === 1 ? 0 : 1]}`);
	return `${places.length} ${places.length === 1 ? "place" : "places"}: ${parts.join(", ")}`;
}
const HOME_RADIUS_M = 5_000;

interface Props {
	fogOn: boolean;
	onFogChange: (value: boolean) => void;
	stats: ExploreStats | null;
	home?: LngLat;
	shareAround: (center: LngLat, radiusM: number) => number;
	onReset: () => void;
	isDriving: boolean;
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<Box sx={{ p: 1.5, borderRadius: 2, border: "1px solid", borderColor: "divider", minWidth: 0 }}>
			<Typography noWrap sx={{ fontSize: 32, fontWeight: 800 }}>{value}</Typography>
			<Typography noWrap sx={{ fontSize: 18, color: "text.secondary" }}>{label}</Typography>
		</Box>
	);
}

const km = (value: number) => value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString("en-NZ");

/** Settings → Explore: the fog of war switch, how much has been explored, and what was found. */
export default function ExplorePanel({ fogOn, onFogChange, stats, home, shareAround, onReset, isDriving }: Props) {
	const [confirming, setConfirming] = useState(false);
	const [showAll, setShowAll] = useState(false);
	useEffect(() => { if (!confirming) return; const timer = window.setTimeout(() => setConfirming(false), 5000); return () => window.clearTimeout(timer); }, [confirming]);
	const homeShare = home && stats ? shareAround(home, HOME_RADIUS_M) : null;
	const since = stats ? new Date(stats.startedAt).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" }) : "";
	return (
		<>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Box>
					<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Fog of war</Typography>
					<Typography sx={{ fontSize: 20, color: "text.secondary" }}>Covers the map in fog everywhere you have not driven. You see about 50 m either side of the road, and driving right round a park or block uncovers the middle. Your route always shows through. Drives are recorded even while the fog is hidden.</Typography>
				</Box>
				<Box role="group" aria-label="Fog of war" sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
					{([[true, "Show fog"], [false, "Hide fog"]] as const).map(([value, text]) => <DriveButton key={text} className="settings-option" variant={fogOn === value ? "contained" : "outlined"} aria-pressed={fogOn === value} onClick={() => onFogChange(value)}>{text}</DriveButton>)}
				</Box>
			</Box>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Box>
					<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Your exploring</Typography>
					{stats && <Typography sx={{ fontSize: 20, color: "text.secondary" }}>Since {since}.</Typography>}
				</Box>
				{stats ? (
					<Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 1 }}>
						<Stat label="Explored" value={`${stats.areaKm2 < 10 ? stats.areaKm2.toFixed(2) : km(stats.areaKm2)} km²`} />
						<Stat label="Driven" value={`${km(stats.distanceKm)} km`} />
						<Stat label="On new roads" value={`${km(stats.newDistanceKm)} km`} />
						<Stat label="Places found" value={String(stats.places.length)} />
						{homeShare !== null && <Stat label="Within 5 km of home" value={`${homeShare < 0.1 ? (homeShare * 100).toFixed(1) : Math.round(homeShare * 100)}%`} />}
					</Box>
				) : <Typography sx={{ fontSize: 20, color: "text.secondary" }}>Loading…</Typography>}
			</Box>
			{stats && stats.places.length > 0 && (
				<Box sx={{ display: "grid", gap: 1 }}>
					<Box>
						<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Discovered</Typography>
						<Typography sx={{ fontSize: 20, color: "text.secondary" }}>{placeSummary(stats.places)}</Typography>
					</Box>
					{(showAll ? stats.places : stats.places.slice(0, RECENT)).map(place => (
						<Box key={place.id} sx={{ display: "flex", alignItems: "baseline", gap: 1.5, minWidth: 0 }}>
							<Typography noWrap sx={{ fontSize: 23, fontWeight: 700, flex: 1, minWidth: 0 }}>{place.name}</Typography>
							<Typography noWrap sx={{ fontSize: 19, color: "text.secondary" }}>{KIND_NAME[place.kind]} · {new Date(place.at).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}</Typography>
						</Box>
					))}
					{stats.places.length > RECENT && (
						<DriveButton className="settings-option" variant="outlined" onClick={() => setShowAll(all => !all)}>
							{showAll ? "Show fewer" : `Show all ${stats.places.length}`}
						</DriveButton>
					)}
				</Box>
			)}
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Box>
					<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Start again</Typography>
					<Typography sx={{ fontSize: 20, color: "text.secondary" }}>Clears this profile's explored map, stats and discovered places. Only while parked.</Typography>
				</Box>
				<DriveButton className="settings-option" color="error" variant={confirming ? "contained" : "outlined"} disabled={isDriving || !stats}
					onClick={() => { if (confirming) { onReset(); setConfirming(false); } else setConfirming(true); }}>
					{confirming ? "Tap again to clear everything" : "Clear explored map"}
				</DriveButton>
			</Box>
		</>
	);
}
