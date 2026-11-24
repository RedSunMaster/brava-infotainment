import React, { useEffect, useState } from "react";
import { Box, LinearProgress, Typography } from "@mui/material";
import DriveButton from "./DriveButton";
import type { ExploreStats } from "../hooks/useExploration";
import type { LngLat } from "../lib/exploration";
import { AREA_STEPS, ROAD_STEPS, nextStep } from "../lib/milestones";
import { FULLY_EXPLORED } from "../lib/suburbs";

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
	stats: ExploreStats | null;
	home?: LngLat;
	shareAround: (center: LngLat, radiusM: number) => number;
	onReset: () => void;
	isDriving: boolean;
}

export function Stat({ label, value }: { label: string; value: string }) {
	return (
		<Box sx={{ p: 1.5, borderRadius: 2, border: "1px solid", borderColor: "divider", minWidth: 0 }}>
			<Typography noWrap sx={{ fontSize: 32, fontWeight: 800 }}>{value}</Typography>
			<Typography noWrap sx={{ fontSize: 18, color: "text.secondary" }}>{label}</Typography>
		</Box>
	);
}

/** Progress through a suburb as a percentage (rounded down, so 100% means done). */
const percent = (share: number) => `${Math.floor(share * 100)}%`;
const shortDate = (at: number) => new Date(at).toLocaleDateString("en-NZ", { day: "numeric", month: "short" });

/** A section's list: the first RECENT rows, and a button for the rest. */
function ShowMore({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
	if (count <= RECENT) return null;
	return <DriveButton className="settings-option" variant="outlined" onClick={onToggle}>{open ? "Show fewer" : `Show all ${count}`}</DriveButton>;
}

const km = (value: number) => value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString("en-NZ");

/** Fog of War stats in Settings → Game Modes: how much has been explored, and what was found. */
export default function ExplorePanel({ stats, home, shareAround, onReset, isDriving }: Props) {
	const [confirming, setConfirming] = useState(false);
	const [showAll, setShowAll] = useState(false);
	const [allSuburbs, setAllSuburbs] = useState(false);
	const [allMilestones, setAllMilestones] = useState(false);
	useEffect(() => { if (!confirming) return; const timer = window.setTimeout(() => setConfirming(false), 5000); return () => window.clearTimeout(timer); }, [confirming]);
	const homeShare = home && stats ? shareAround(home, HOME_RADIUS_M) : null;
	const since = stats ? new Date(stats.startedAt).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" }) : "";
	return (
		<>
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
			{stats && stats.suburbs.length > 0 && (
				<Box sx={{ display: "grid", gap: 1.25 }}>
					<Box>
						<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Suburbs</Typography>
						<Typography sx={{ fontSize: 20, color: "text.secondary" }}>
							{stats.suburbs.filter(suburb => suburb.share >= 1).length} of {stats.suburbs.length} fully explored. The backs of some sections can never be seen from a road, so {Math.round(FULLY_EXPLORED * 100)}% of a suburb counts as all of it.
						</Typography>
					</Box>
					{(allSuburbs ? stats.suburbs : stats.suburbs.slice(0, RECENT)).map(suburb => (
						<Box key={suburb.id} sx={{ display: "grid", gap: 0.5, minWidth: 0 }}>
							<Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, minWidth: 0 }}>
								<Typography noWrap sx={{ fontSize: 23, fontWeight: 700, flex: 1, minWidth: 0 }}>{suburb.name}</Typography>
								<Typography sx={{ fontSize: 21, fontWeight: 700, color: suburb.share >= 1 ? "success.main" : "text.secondary" }}>{percent(suburb.share)}</Typography>
							</Box>
							<LinearProgress variant="determinate" value={suburb.share * 100} color={suburb.share >= 1 ? "success" : "primary"} sx={{ height: 10, borderRadius: 5 }} />
						</Box>
					))}
					<ShowMore count={stats.suburbs.length} open={allSuburbs} onToggle={() => setAllSuburbs(all => !all)} />
				</Box>
			)}
			{stats && (
				<Box sx={{ display: "grid", gap: 1 }}>
					<Box>
						<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Milestones</Typography>
						<Typography sx={{ fontSize: 20, color: "text.secondary" }}>
							{[
								nextStep(AREA_STEPS, stats.areaKm2) !== null && `Next: ${nextStep(AREA_STEPS, stats.areaKm2)} km² explored`,
								nextStep(ROAD_STEPS, stats.newDistanceKm) !== null && `${nextStep(ROAD_STEPS, stats.newDistanceKm)} km of new roads`,
							].filter(Boolean).join(", ")}.
						</Typography>
					</Box>
					{(allMilestones ? stats.milestones : stats.milestones.slice(0, RECENT)).map(milestone => (
						<Box key={milestone.id} sx={{ display: "flex", alignItems: "baseline", gap: 1.5, minWidth: 0 }}>
							<Typography noWrap sx={{ fontSize: 23, fontWeight: 700, flex: 1, minWidth: 0 }}>{milestone.title}</Typography>
							<Typography noWrap sx={{ fontSize: 19, color: "text.secondary" }}>{shortDate(milestone.at)}</Typography>
						</Box>
					))}
					<ShowMore count={stats.milestones.length} open={allMilestones} onToggle={() => setAllMilestones(all => !all)} />
				</Box>
			)}
			{stats && stats.places.length > 0 && (
				<Box sx={{ display: "grid", gap: 1 }}>
					<Box>
						<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Discovered</Typography>
						<Typography sx={{ fontSize: 20, color: "text.secondary" }}>{placeSummary(stats.places)}</Typography>
					</Box>
					{(showAll ? stats.places : stats.places.slice(0, RECENT)).map(place => (
						<Box key={place.id} sx={{ display: "flex", alignItems: "baseline", gap: 1.5, minWidth: 0 }}>
							<Typography noWrap sx={{ fontSize: 23, fontWeight: 700, flex: 1, minWidth: 0 }}>{place.name}</Typography>
							<Typography noWrap sx={{ fontSize: 19, color: "text.secondary" }}>{KIND_NAME[place.kind]} · {shortDate(place.at)}</Typography>
						</Box>
					))}
					<ShowMore count={stats.places.length} open={showAll} onToggle={() => setShowAll(all => !all)} />
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
