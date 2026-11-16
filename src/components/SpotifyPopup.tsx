import React, { useEffect, useState } from "react";
import { Alert, Box, LinearProgress, Popover, Typography } from "@mui/material";
import MusicNoteRounded from "@mui/icons-material/MusicNoteRounded";
import SkipPreviousRounded from "@mui/icons-material/SkipPreviousRounded";
import SkipNextRounded from "@mui/icons-material/SkipNextRounded";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import PauseRounded from "@mui/icons-material/PauseRounded";
import ShuffleRounded from "@mui/icons-material/ShuffleRounded";
import RepeatRounded from "@mui/icons-material/RepeatRounded";
import RepeatOneRounded from "@mui/icons-material/RepeatOneRounded";
import RemoveRounded from "@mui/icons-material/RemoveRounded";
import AddRounded from "@mui/icons-material/AddRounded";
import VolumeUpRounded from "@mui/icons-material/VolumeUpRounded";
import LibraryMusicRounded from "@mui/icons-material/LibraryMusicRounded";
import { UseSpotifyReturn } from "../hooks/useSpotify";
import DriveButton from "./DriveButton";
import SpotifyLibrary from "./SpotifyLibrary";
import { useKeyboard } from "../contexts/KeyboardContext";

interface Props { spotify: UseSpotifyReturn; isDriving: boolean }
function formatTime(ms: number) {
 const seconds = Math.max(0, Math.floor(ms / 1000));
 return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export default function SpotifyPopup({ spotify, isDriving }: Props) {
 const [libraryOpen, setLibraryOpen] = useState(false);
 const [volumeAnchor, setVolumeAnchor] = useState<HTMLElement | null>(null);
 const [error, setError] = useState<string | null>(null);
 const { hideKeyboard } = useKeyboard();
 useEffect(() => () => hideKeyboard(), [hideKeyboard]);
 useEffect(() => { if (isDriving) setLibraryOpen(false); }, [isDriving]);
 async function run(action: () => Promise<void>) {
  setError(null);
  try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Playback unavailable. Try again."); }
 }
 const { track } = spotify;
 return <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minHeight: 0 }}>
  {(error || spotify.error) && <Alert severity="error">{error || spotify.error}</Alert>}
  {libraryOpen ? <Box sx={{ height: "min(42vh, 650px)", minHeight: 240 }}><SpotifyLibrary spotify={spotify} isDriving={isDriving} onBack={() => { hideKeyboard(); setLibraryOpen(false); }} /></Box> : <>
   <Box sx={{ display: "flex", gap: 2, alignItems: "center", minWidth: 0 }}>
    <Box sx={{ width: "clamp(80px, 11vw, 120px)", aspectRatio: "1", borderRadius: 2, bgcolor: "action.hover", flexShrink: 0, overflow: "hidden", display: "grid", placeItems: "center" }}>
     {track?.albumArt ? <Box component="img" src={track.albumArt} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <MusicNoteRounded sx={{ fontSize: 60, color: "text.secondary" }} />}
    </Box>
    <Box sx={{ flex: 1, minWidth: 0 }}>
     <Typography sx={{ fontSize: 20, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em" }}>Now playing</Typography>
     <Typography noWrap sx={{ fontSize: "clamp(26px, 3vw, 34px)", fontWeight: 800 }}>{track?.name ?? "Your music"}</Typography>
     <Typography noWrap sx={{ fontSize: 24, color: "text.secondary" }}>{track?.artists ?? (spotify.isConnected ? "Open Spotify on a device to start playback" : "Connect Spotify while parked")}</Typography>
     {track?.albumName && <Typography noWrap sx={{ fontSize: 20, color: "text.secondary" }}>{track.albumName}</Typography>}
    </Box>
    {spotify.isConnected && <>
     <DriveButton color="inherit" disabled={!track} aria-label={`Spotify volume ${spotify.volume}%`} aria-expanded={Boolean(volumeAnchor)} aria-controls={volumeAnchor ? "spotify-volume" : undefined} onClick={(event) => setVolumeAnchor(event.currentTarget)} sx={{ flexShrink: 0, flexDirection: "column", fontSize: 20 }}><VolumeUpRounded />{spotify.volume}%</DriveButton>
     <DriveButton disabled={isDriving} variant="outlined" aria-label="Browse library" onClick={() => setLibraryOpen(true)} sx={{ flexShrink: 0 }}><LibraryMusicRounded /></DriveButton>
    </>}
   </Box>
   {!spotify.isConnected ? <DriveButton variant="contained" disabled={isDriving || spotify.isLoading} onClick={() => void run(spotify.connect)}>{spotify.isLoading ? "Connecting…" : "Connect Spotify"}</DriveButton> : <>
    {track && <Box>
     <LinearProgress aria-label="Track progress" variant="determinate" value={track.durationMs > 0 ? Math.min(100, Math.max(0, track.progressMs / track.durationMs * 100)) : 0} sx={{ height: 6, borderRadius: 3 }} />
     <Box sx={{ display: "flex", justifyContent: "space-between", color: "text.secondary", fontSize: 20, mt: 0.5 }}><span>{formatTime(track.progressMs)}</span><span>{formatTime(track.durationMs)}</span></Box>
    </Box>}
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 1 }}>
     <DriveButton color={track?.shuffle ? "primary" : "inherit"} disabled={!track} aria-label="Shuffle" aria-pressed={track?.shuffle ?? false} onClick={() => void run(spotify.toggleShuffle)}><ShuffleRounded /></DriveButton>
     <DriveButton color="inherit" disabled={!track} aria-label="Previous track" onClick={() => void run(spotify.previous)}><SkipPreviousRounded /></DriveButton>
     <DriveButton variant="contained" disabled={!track} aria-label={track?.isPlaying ? "Pause music" : "Play music"} onClick={() => void run(track?.isPlaying ? spotify.pause : spotify.play)}>{track?.isPlaying ? <PauseRounded /> : <PlayArrowRounded />}</DriveButton>
     <DriveButton color="inherit" disabled={!track} aria-label="Next track" onClick={() => void run(spotify.next)}><SkipNextRounded /></DriveButton>
     <DriveButton color={track?.repeat !== "off" && track ? "primary" : "inherit"} disabled={!track} aria-label={`Repeat ${track?.repeat ?? "off"}`} onClick={() => void run(spotify.cycleRepeat)}>{track?.repeat === "track" ? <RepeatOneRounded /> : <RepeatRounded />}</DriveButton>
    </Box>
    <Popover id="spotify-volume" open={Boolean(volumeAnchor)} anchorEl={volumeAnchor} onClose={() => setVolumeAnchor(null)} anchorOrigin={{ vertical: "top", horizontal: "center" }} transformOrigin={{ vertical: "bottom", horizontal: "center" }} slotProps={{ paper: { sx: { p: 1, borderRadius: 3, bgcolor: "background.paper", border: "1px solid", borderColor: "divider" } } }}>
     <Box role="group" aria-label="Spotify volume" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <DriveButton color="inherit" disabled={!track || spotify.volume === 0} aria-label="Decrease Spotify volume" onClick={() => void run(() => spotify.setVolume(Math.max(0, spotify.volume - 10)))}><RemoveRounded /></DriveButton>
      <Typography aria-live="polite" sx={{ minWidth: 64, textAlign: "center", fontSize: 24 }}>{spotify.volume}%</Typography>
      <DriveButton color="inherit" disabled={!track || spotify.volume === 100} aria-label="Increase Spotify volume" onClick={() => void run(() => spotify.setVolume(Math.min(100, spotify.volume + 10)))}><AddRounded /></DriveButton>
     </Box>
    </Popover>
   </>}
  </>}
 </Box>;
}
