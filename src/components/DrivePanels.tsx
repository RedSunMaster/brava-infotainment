import React, { useEffect, useMemo, useState } from "react";
import { Box, LinearProgress, Typography } from "@mui/material";
import DriveButton from "./DriveButton";
import { Stat } from "./ExplorePanel";
import { BAND_LABEL, driveStats, scoreBand, tripSeconds, type ScoreBand, type Trip } from "../lib/drives";
import { computeStreaks, currentChallenges, type ChallengeProgress } from "../lib/driveChallenges";
import { clock, routeRecords } from "../lib/raceGhost";

const km = (metres: number) => { const value = metres / 1000; return value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString("en-NZ"); };
const duration = (seconds: number) => { const total = Math.round(seconds / 60); return total < 60 ? `${total} min` : `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} m`; };
const when = (at: number) => new Date(at).toLocaleString("en-NZ", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const day = (at: number) => new Date(at).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
const RECENT = 6;
const BAND_COLOUR: Record<ScoreBand, string> = { great: "success.main", good: "success.main", fair: "warning.main", rough: "error.main" };

function Heading({ title, note }: { title: string; note?: string }) {
	return (
		<Box>
			<Typography sx={{ fontSize: 25, fontWeight: 700 }}>{title}</Typography>
			{note && <Typography sx={{ fontSize: 20, color: "text.secondary" }}>{note}</Typography>}
		</Box>
	);
}

function ScoreChip({ score }: { score: number | null }) {
	if (score === null) return <Typography sx={{ fontSize: 21, color: "text.secondary", minWidth: 56, textAlign: "right" }}>—</Typography>;
	return <Typography sx={{ fontSize: 24, fontWeight: 800, color: BAND_COLOUR[scoreBand(score)], minWidth: 56, textAlign: "right" }}>{score}</Typography>;
}

/** The trip's road as a small line drawing. */
function RoutePreview({ track }: { track: number[] }) {
	const path = useMemo(() => {
		const points: [number, number][] = [];
		for (let i = 0; i + 2 < track.length; i += 3) points.push([track[i], track[i + 1]]);
		if (points.length < 2) return "";
		const cos = Math.cos((points[0][1] * Math.PI) / 180);
		const xs = points.map(p => p[0] * cos), ys = points.map(p => -p[1]);
		const minX = Math.min(...xs), minY = Math.min(...ys);
		const scale = Math.min(280 / Math.max(1e-9, Math.max(...xs) - minX), 100 / Math.max(1e-9, Math.max(...ys) - minY));
		return points.map((_, i) => `${i ? "L" : "M"}${(10 + (xs[i] - minX) * scale).toFixed(1)} ${(10 + (ys[i] - minY) * scale).toFixed(1)}`).join(" ");
	}, [track]);
	if (!path) return null;
	return (
		<Box component="svg" viewBox="0 0 300 120" role="img" aria-label="Route" sx={{ width: "100%", maxHeight: 150, borderRadius: 2, bgcolor: "action.hover" }}>
			<path d={path} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={{ color: "#2563eb" }} />
		</Box>
	);
}

function TripRow({ trip, open, onToggle }: { trip: Trip; open: boolean; onToggle: () => void }) {
	const seconds = tripSeconds(trip);
	return (
		<Box sx={{ display: "grid", gap: 0.75 }}>
			<DriveButton className="settings-option" color="inherit" variant={open ? "contained" : "text"} onClick={onToggle} sx={{ justifyContent: "flex-start", textTransform: "none", gap: 1.5, textAlign: "left" }}>
				<Box sx={{ flex: 1, minWidth: 0 }}>
					<Typography noWrap sx={{ fontSize: 23, fontWeight: 700 }}>{when(trip.start)}</Typography>
					<Typography noWrap sx={{ fontSize: 19, color: "text.secondary" }}>
						{km(trip.distanceM)} km · {duration(seconds)}{trip.race ? ` · ${trip.race.deltaS < 0 ? `${clock(trip.race.deltaS)} faster than ghost` : `${clock(trip.race.deltaS)} slower than ghost`}` : ""}
					</Typography>
				</Box>
				<ScoreChip score={trip.score} />
			</DriveButton>
			{open && (
				<Box sx={{ display: "grid", gap: 1, px: 1 }}>
					{trip.track && <RoutePreview track={trip.track} />}
					<Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 1 }}>
						<Stat label="Top speed" value={`${Math.round(trip.maxSpeed * 3.6)} km/h`} />
						<Stat label="Average moving" value={trip.movingS > 0 ? `${Math.round((trip.distanceM / trip.movingS) * 3.6)} km/h` : "—"} />
						<Stat label="Hard brakes" value={String(trip.hardBrakes)} />
						<Stat label="Hard starts" value={String(trip.hardAccels)} />
						<Stat label="Sharp corners" value={String(trip.hardCorners)} />
						<Stat label="Over the limit" value={trip.limitedS >= 60 ? `${Math.round((trip.speedingS / trip.limitedS) * 100)}%` : "No limits known"} />
					</Box>
				</Box>
			)}
		</Box>
	);
}

function ChallengeRow({ challenge }: { challenge: ChallengeProgress }) {
	return (
		<Box sx={{ display: "grid", gap: 0.5, minWidth: 0 }}>
			<Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, minWidth: 0 }}>
				<Typography sx={{ fontSize: 22, fontWeight: 700, flex: 1, minWidth: 0 }}>{challenge.title}</Typography>
				<Typography noWrap sx={{ fontSize: 19, fontWeight: 700, color: challenge.done ? "success.main" : "text.secondary" }}>{challenge.done ? "Done" : challenge.display}</Typography>
			</Box>
			<LinearProgress variant="determinate" value={challenge.fraction * 100} color={challenge.done ? "success" : "primary"} sx={{ height: 10, borderRadius: 5 }} />
		</Box>
	);
}

/** The smooth-driving figures and the switch for the score on the map. */
function SmoothSection({ trips, showScore, onShowScoreChange }: { trips: Trip[]; showScore: boolean; onShowScoreChange: (value: boolean) => void }) {
	const now = Date.now();
	const stats = useMemo(() => driveStats(trips, now), [trips, now]);
	const recent = useMemo(() => trips.filter(trip => trip.score !== null).slice(-12), [trips]);
	return (
		<>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Heading title="Smooth driving" note="Every trip is scored out of 100, always, whichever game is on." />
				<Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 1 }}>
					<Stat label="Average score" value={stats.averageScore === null ? "—" : `${stats.averageScore} · ${BAND_LABEL[scoreBand(stats.averageScore)]}`} />
					<Stat label="Best trip" value={stats.bestScore === null ? "—" : String(stats.bestScore)} />
					<Stat label="This week" value={stats.week.averageScore === null ? "—" : String(stats.week.averageScore)} />
					<Stat label="Hard brakes" value={String(stats.hardBrakes)} />
				</Box>
				{recent.length > 0 && (
					<Box aria-label="Recent scores, newest on the right" sx={{ display: "flex", alignItems: "flex-end", gap: 0.75, height: 90 }}>
						{recent.map(trip => <Box key={trip.id} title={`${trip.score}`} sx={{ flex: 1, height: `${Math.max(6, trip.score as number)}%`, borderRadius: 1, bgcolor: BAND_COLOUR[scoreBand(trip.score as number)] }} />)}
					</Box>
				)}
			</Box>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Heading title="Score on the map" note="The live score shows at the top of the map during a trip." />
				<Box role="group" aria-label="Score on the map" sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
					{([[true, "On"], [false, "Off"]] as const).map(([value, text]) => <DriveButton key={text} className="settings-option" variant={showScore === value ? "contained" : "outlined"} aria-pressed={showScore === value} onClick={() => onShowScoreChange(value)}>{text}</DriveButton>)}
				</Box>
				<Typography sx={{ fontSize: 20, color: "text.secondary" }}>
					Hard braking, hard starts and sharp corners each cost points, in proportion to how often they happen per kilometre. Time over the speed limit costs up to a quarter of the score, where the limit is known. 90 or more is silky, 75 smooth, 55 bumpy. Trips under about a kilometre are not scored.
				</Typography>
			</Box>
		</>
	);
}

interface TripsProps { trips: Trip[]; loaded: boolean; onReset: () => void; isDriving: boolean; showScore: boolean; onShowScoreChange: (value: boolean) => void }

/** Settings → Trips: streaks, the day's and week's challenges, smooth driving, totals, and every trip. */
export function TripsPanel({ trips, loaded, onReset, isDriving, showScore, onShowScoreChange }: TripsProps) {
	const [open, setOpen] = useState<string | null>(null);
	const [showAll, setShowAll] = useState(false);
	const [confirming, setConfirming] = useState(false);
	useEffect(() => { if (!confirming) return; const timer = window.setTimeout(() => setConfirming(false), 5000); return () => window.clearTimeout(timer); }, [confirming]);
	const now = Date.now();
	const stats = useMemo(() => driveStats(trips, now), [trips, now]);
	const streaks = useMemo(() => computeStreaks(trips, now), [trips, now]);
	const challenges = useMemo(() => currentChallenges(now, trips), [trips, now]);
	const newest = useMemo(() => trips.slice().reverse(), [trips]);
	if (!loaded) return <Typography sx={{ fontSize: 20, color: "text.secondary" }}>Loading…</Typography>;
	return (
		<>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Heading title="Streaks" note={streaks.drivenToday ? "You have driven today." : streaks.days > 0 ? "Drive 1 km today to keep your streak." : "Drive 1 km to start a streak."} />
				<Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 1 }}>
					<Stat label={`Days in a row · best ${streaks.bestDays}`} value={String(streaks.days)} />
					<Stat label={`Smooth trips in a row · best ${streaks.bestSmooth}`} value={String(streaks.smooth)} />
					<Stat label={`Challenge days · best ${streaks.bestChallenges}`} value={String(streaks.challenges)} />
				</Box>
			</Box>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Heading title="Today's challenges" note="New ones each day, the same on every drive." />
				{challenges.daily.map(challenge => <ChallengeRow key={challenge.id} challenge={challenge} />)}
			</Box>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Heading title="This week" note="Weeks run Monday to Sunday." />
				{challenges.weekly.map(challenge => <ChallengeRow key={challenge.id} challenge={challenge} />)}
			</Box>
			<SmoothSection trips={trips} showScore={showScore} onShowScoreChange={onShowScoreChange} />
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Heading title="Totals" note={trips.length ? `Since ${day(trips[0].start)}.` : "No trips yet. Drive somewhere and it will appear here."} />
				{trips.length > 0 && (
					<Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 1 }}>
						<Stat label="Trips" value={String(stats.trips)} />
						<Stat label="Distance" value={`${km(stats.distanceM)} km`} />
						<Stat label="Time driving" value={duration(stats.drivingS)} />
						<Stat label="Longest trip" value={`${km(stats.longestM)} km`} />
						<Stat label="Top speed" value={`${Math.round(stats.topSpeed * 3.6)} km/h`} />
						<Stat label="Last 7 days" value={`${km(stats.week.distanceM)} km`} />
					</Box>
				)}
			</Box>
			{newest.length > 0 && (
				<Box sx={{ display: "grid", gap: 1 }}>
					<Heading title="Trip history" note="Tap a trip for its route and details." />
					{(showAll ? newest : newest.slice(0, RECENT)).map(trip => <TripRow key={trip.id} trip={trip} open={open === trip.id} onToggle={() => setOpen(current => current === trip.id ? null : trip.id)} />)}
					{newest.length > RECENT && <DriveButton className="settings-option" variant="outlined" onClick={() => setShowAll(all => !all)}>{showAll ? "Show fewer" : `Show all ${newest.length}`}</DriveButton>}
				</Box>
			)}
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Heading title="Start again" note="Clears this profile's trips, streaks, challenge progress and ghosts. Only while parked." />
				<DriveButton className="settings-option" color="error" variant={confirming ? "contained" : "outlined"} disabled={isDriving || trips.length === 0}
					onClick={() => { if (confirming) { onReset(); setConfirming(false); } else setConfirming(true); }}>
					{confirming ? "Tap again to clear everything" : "Clear trip history"}
				</DriveButton>
			</Box>
		</>
	);
}

interface ModeProps { trips: Trip[]; playing: boolean }

/** Ghost Race's records in Settings → Game Modes. */
export function GhostPanel({ trips, playing }: ModeProps) {
	const records = useMemo(() => routeRecords(trips), [trips]);
	const raced = trips.filter(trip => trip.race);
	const wins = raced.filter(trip => (trip.race?.deltaS ?? 0) < 0).length;
	return (
		<>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Heading title="Your races" note={`${playing ? "" : "Choose Ghost Race above to see the ghost on the map. "}Your fastest run of a route is its ghost. A route is the same if it starts and ends in the same places.`} />
				<Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 1 }}>
					<Stat label="Routes driven twice or more" value={String(records.length)} />
					<Stat label="Ghost races" value={String(raced.length)} />
					<Stat label="Ghosts beaten" value={String(wins)} />
				</Box>
			</Box>
			{records.length > 0 ? (
				<Box sx={{ display: "grid", gap: 1 }}>
					<Heading title="Best times" />
					{records.slice(0, 12).map(record => (
						<Box key={record.best.id} sx={{ display: "flex", alignItems: "baseline", gap: 1.5, minWidth: 0 }}>
							<Box sx={{ flex: 1, minWidth: 0 }}>
								<Typography noWrap sx={{ fontSize: 23, fontWeight: 700 }}>{km(record.best.distanceM)} km route · {clock(tripSeconds(record.best))}</Typography>
								<Typography noWrap sx={{ fontSize: 19, color: "text.secondary" }}>Set {day(record.best.start)} · driven {record.runs} times · {record.wins} {record.wins === 1 ? "win" : "wins"}</Typography>
							</Box>
						</Box>
					))}
				</Box>
			) : <Typography sx={{ fontSize: 20, color: "text.secondary" }}>No route driven twice yet. Drive the same trip again and the first run becomes the ghost.</Typography>}
		</>
	);
}
