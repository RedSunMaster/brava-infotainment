import React, { useEffect, useState } from "react";
import { Box, LinearProgress, Typography } from "@mui/material";
import MusicNoteRounded from "@mui/icons-material/MusicNoteRounded";
import SkipPreviousRounded from "@mui/icons-material/SkipPreviousRounded";
import SkipNextRounded from "@mui/icons-material/SkipNextRounded";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import PauseRounded from "@mui/icons-material/PauseRounded";
import ShuffleRounded from "@mui/icons-material/ShuffleRounded";
import RepeatRounded from "@mui/icons-material/RepeatRounded";
import RepeatOneRounded from "@mui/icons-material/RepeatOneRounded";
import ChevronLeftRounded from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import VolumeUpRounded from "@mui/icons-material/VolumeUpRounded";
import KeyboardArrowDownRounded from "@mui/icons-material/KeyboardArrowDownRounded";
import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import LibraryMusicRounded from "@mui/icons-material/LibraryMusicRounded";
import { UseSpotifyReturn } from "../hooks/useSpotify";
import DriveButton from "./DriveButton";
import SpotifyLibrary from "./SpotifyLibrary";
import { useKeyboard } from "../contexts/KeyboardContext";

interface Props { spotify: UseSpotifyReturn; isDriving: boolean; /** Closes the player; shown as an arrow in the header. */ onClose?: () => void }
function formatTime(ms: number) {
 const seconds = Math.max(0, Math.floor(ms / 1000));
 return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
// The same filled, rounded look as the steppers in the dock below.
const STEP_BUTTON = { bgcolor: "surface.main", borderRadius: 3, "&:hover": { bgcolor: "surface.main" }, "& .MuiSvgIcon-root": { fontSize: 34 } } as const;
const TRANSPORT = { minHeight: 72, minWidth: 0, borderRadius: 3, "& .MuiSvgIcon-root": { fontSize: 44 } } as const;
export default function SpotifyPopup({ spotify, isDriving, onClose }: Props) {
 const [libraryOpen, setLibraryOpen] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const { hideKeyboard } = useKeyboard();
 useEffect(() => () => hideKeyboard(), [hideKeyboard]);
 useEffect(() => { if (isDriving) setLibraryOpen(false); }, [isDriving]);
 async function run(action: () => Promise<void>) {
  setError(null);
  try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Playback unavailable. Try again."); }
 }
 const { track } = spotify;
 const problem = error || spotify.error;
 return <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, minHeight: 0 }}>
  {libraryOpen ? <Box sx={{ height: "min(42vh, 650px)", minHeight: 240 }}><SpotifyLibrary spotify={spotify} isDriving={isDriving} onBack={() => { hideKeyboard(); setLibraryOpen(false); }} /></Box> : <>
   {/* Header: artwork, what is playing, the library, and the way out, all on one row. */}
   <Box sx={{ display: "flex", gap: 2, alignItems: "center", minWidth: 0 }}>
    <Box sx={{ width: 80, height: 80, borderRadius: 2, bgcolor: "action.hover", flexShrink: 0, overflow: "hidden", display: "grid", placeItems: "center" }}>
     {track?.albumArt ? <Box component="img" src={track.albumArt} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <MusicNoteRounded sx={{ fontSize: 56, color: "text.secondary" }} />}
    </Box>
    <Box sx={{ flex: 1, minWidth: 0 }}>
     <Typography noWrap sx={{ fontSize: 30, fontWeight: 800, lineHeight: 1.2 }}>{track?.name ?? "Your music"}</Typography>
     <Typography noWrap sx={{ fontSize: 24, color: "text.secondary" }}>{track ? [track.artists, track.albumName].filter(Boolean).join(" · ") : spotify.isConnected ? "Nothing playing. Press play, or pick something in Library." : "Connect Spotify while parked"}</Typography>
    </Box>
    {spotify.isConnected && <DriveButton disabled={isDriving} aria-label="Browse library" onClick={() => setLibraryOpen(true)} startIcon={<LibraryMusicRounded />} sx={{ ...STEP_BUTTON, flexShrink: 0, minHeight: 72, px: 2, fontSize: 22, fontWeight: 700 }}>Library</DriveButton>}
    {onClose && <DriveButton color="inherit" aria-label="Close music player" onClick={onClose} sx={{ ...STEP_BUTTON, flexShrink: 0, minHeight: 72, minWidth: 72 }}><KeyboardArrowDownRounded /></DriveButton>}
   </Box>
   {/* Problems are a quiet line under the header, with a way to fix them when parked. */}
   {problem && <Box role="status" sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, borderRadius: 2, bgcolor: "action.hover", border: "1px solid", borderColor: "warning.main" }}>
    <WarningAmberRounded aria-hidden sx={{ color: "warning.main", fontSize: 28, flexShrink: 0 }} />
    <Typography sx={{ flex: 1, minWidth: 0, fontSize: 22 }}>{problem}</Typography>
    {!isDriving && spotify.isConnected && <DriveButton variant="outlined" onClick={() => void run(spotify.connect)} sx={{ flexShrink: 0, minHeight: 56, px: 2 }}>Reconnect</DriveButton>}
   </Box>}
   {!spotify.isConnected ? <DriveButton variant="contained" disabled={isDriving || spotify.isLoading} onClick={() => void run(spotify.connect)}>{spotify.isLoading ? "Connecting…" : "Connect Spotify"}</DriveButton> : <>
    {track && <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
     <Typography sx={{ fontSize: 22, color: "text.secondary", minWidth: 56, fontVariantNumeric: "tabular-nums" }}>{formatTime(track.progressMs)}</Typography>
     <LinearProgress aria-label="Track progress" variant="determinate" value={track.durationMs > 0 ? Math.min(100, Math.max(0, track.progressMs / track.durationMs * 100)) : 0} sx={{ flex: 1, height: 10, borderRadius: 5 }} />
     <Typography sx={{ fontSize: 22, color: "text.secondary", minWidth: 56, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTime(track.durationMs)}</Typography>
    </Box>}
    {/* Transport: previous, play/pause and next are the big ones; shuffle and repeat sit at the edges. */}
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
     <DriveButton color={track?.shuffle ? "primary" : "inherit"} disabled={!track} aria-label="Shuffle" aria-pressed={track?.shuffle ?? false} onClick={() => void run(spotify.toggleShuffle)} sx={{ ...STEP_BUTTON, flex: "0 0 72px", minHeight: 64, minWidth: 0 }}><ShuffleRounded /></DriveButton>
     <DriveButton color="inherit" disabled={!track} aria-label="Previous track" onClick={() => void run(spotify.previous)} sx={{ ...STEP_BUTTON, ...TRANSPORT, flex: "0 0 112px" }}><SkipPreviousRounded /></DriveButton>
     <DriveButton variant="contained" aria-label={track?.isPlaying ? "Pause music" : "Play music"} onClick={() => void run(track?.isPlaying ? spotify.pause : spotify.play)} sx={{ ...TRANSPORT, flex: "0 0 150px" }}>{track?.isPlaying ? <PauseRounded /> : <PlayArrowRounded />}</DriveButton>
     <DriveButton color="inherit" disabled={!track} aria-label="Next track" onClick={() => void run(spotify.next)} sx={{ ...STEP_BUTTON, ...TRANSPORT, flex: "0 0 112px" }}><SkipNextRounded /></DriveButton>
     <DriveButton color={track?.repeat !== "off" && track ? "primary" : "inherit"} disabled={!track} aria-label={`Repeat ${track?.repeat ?? "off"}`} onClick={() => void run(spotify.cycleRepeat)} sx={{ ...STEP_BUTTON, flex: "0 0 72px", minHeight: 64, minWidth: 0 }}>{track?.repeat === "track" ? <RepeatOneRounded /> : <RepeatRounded />}</DriveButton>
     {/* Volume, small and at the end of the row, in the same form as the music card. */}
     <Box role="group" aria-label={`Spotify volume ${spotify.volume}%`} sx={{ display: "flex", alignItems: "center", ml: 1, pl: 1.5, borderLeft: "1px solid", borderColor: "divider" }}>
      <DriveButton color="inherit" disabled={!track || spotify.volume <= 0} aria-label="Decrease Spotify volume" onClick={() => void run(() => spotify.setVolume(Math.max(0, Math.ceil(spotify.volume / 10) * 10 - 10)))} sx={{ minWidth: 0, flex: "0 0 52px", minHeight: 64 }}><ChevronLeftRounded /></DriveButton>
      <Box aria-live="polite" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5, minWidth: 92 }}><VolumeUpRounded aria-hidden sx={{ fontSize: 30, color: "text.secondary" }} /><Typography sx={{ fontSize: 28, fontWeight: 500 }}>{spotify.volume}</Typography></Box>
      <DriveButton color="inherit" disabled={!track || spotify.volume >= 100} aria-label="Increase Spotify volume" onClick={() => void run(() => spotify.setVolume(Math.min(100, Math.floor(spotify.volume / 10) * 10 + 10)))} sx={{ minWidth: 0, flex: "0 0 52px", minHeight: 64 }}><ChevronRightRounded /></DriveButton>
     </Box>
    </Box>
   </>}
  </>}
 </Box>;
}
