# End-to-end drive review — driver and passenger

Date: 18 November 2026. Build: `master` at 10c34c0. Driven live in the running Electron preview (`--preview`, the Verbatim 15.6" portrait profile) through the DevTools port, using real taps, touch-swipes and on-screen keyboard presses, with a screenshot after each step. No application code was changed.

## Scenarios run

**Driver.** Parked at home, open Navigate, type a search on the on-screen keyboard, use the Work shortcut, compare routes, Go, drive with guidance, use climate, music, mute, hazards, camera mode and add a stop on the move, end the route, arrive.

**Passenger.** Parked: Settings (all four tabs), Music library and playlists, search. Moving: try everything a passenger would reach for (add stop by typing, fuel quick-stop, music, library, settings).

## What works well (keep these)

- **One-tap Home / Work** in the top bar, then a clean route preview (arrival time, two route choices, large Go).
- **Active guidance** is glanceable: big arrow, distance and street, ETA on its own row, speed bubble beside the posted limit, and a "next step" line.
- **End route** needs an explicit "Keep route / End route" choice.
- **Fuel along your route** shows *detour minutes*, and the stop preview adds "Open 24 hours".
- **Fan and warmth** change with a single tap and no popup. Airflow shows a short label ("Air to feet") after each change.
- **Moving lock** works for Settings, Library, Connect/Reconnect and new destinations.
- Playlists load quickly with cover art and large tiles.

## Findings, in priority order

### A. Safety and policy

| # | Finding | Evidence | Suggested change |
|---|---|---|---|
| A1 | **The full keyboard opens at speed during navigation** (Add stop). It covers the map, music, climate and hazard controls. The app cannot tell driver from passenger. | Opened at 17 km/h in the live run. Intentional: `MapControls.tsx:168` exempts "navigating + search panel" from the moving lock. | Decide the policy explicitly. Safest: while moving, offer only quick-stops, Home/Work/recents and voice; typing needs the car stopped, or an explicit "Passenger is entering this" step. |
| A2 | **Hazard "on" is a faint red tint** on a small triangle: no flashing, no banner, no "screen only, not the real hazard lights" cue. | Screenshot after tap. `VEHICLE_CONNECTED = false` in `CarControls.tsx`. | Until wired to the vehicle, label it clearly as preview. Once wired, show an unmistakable flashing state plus confirmation from the vehicle. |
| A3 | **Exit app** is one unconfirmed tap, next to the routing toggle. | `MapControls.tsx:295`. | Add a confirmation (or hold-to-confirm); consider hiding it from the normal Settings view. |
| A4 | **Keyboard covers the dock** (hazards, fan, warmth) while typing. | Seen parked and moving. | Reserve the hazard/vehicle strip permanently; slide the keyboard above it. |

### B. Bugs and inconsistencies seen live

| # | Finding | Evidence | Suggested change |
|---|---|---|---|
| B1 | **"Traffic not updating" appears on a brand-new route** and stays across trips. | Present within 15 s of starting a fresh trip. `App.tsx:453-457` only clears the flag on a successful refresh and demands an identical-geometry match, so any re-route of the alternatives triggers it. | Reset on route start; only flag on a real failed request; word it as an action ("Traffic data unavailable — retrying"). |
| B2 | **Arrival wording is wrong while still moving.** The card showed "46 m — You have arrived at your destination" at 44 km/h. | Screenshot during the last approach. | Show "Arrive in 46 m" for the final maneuver; say "arrived" only at the end. |
| B3 | **Music state is unreliable.** After a playlist tap that showed "No Spotify playback device is active", playback started ~2 minutes later with no prompt. Displayed volume went 50 → 100 → 20 without my input. Volume changes while paused give "Spotify could not complete this action". Tapping a playlist gives no "Playing…" feedback and closes the library silently. | Observed; I paused once and it was playing again later, so another controller may also have been involved. | Show one truthful state (connecting / ready / playing / failed + reason + Retry). Confirm playback requests ("Playing Ariana Best"). Don't replay a stale request later. Read the real volume back. |
| B4 | **Media panel can hide the car.** The panel grew by one row with an error and the puck vanished behind it (seen parked and moving). | Screenshots with the player open. | Recompute the map padding whenever the panel height changes (including error rows). |
| B5 | **Search ordering and relevance.** For "pakn": 12.0 km, then 4.0 km "PaknGo" (a services business), then 8.5 km. Mixed casing (PAK'nSAVE / Pak'nSave). First results were 9.6 km then 9.3 km. | Results list. | Sort nearest-first within a relevance tier, drop unrelated categories, normalize names. |
| B6 | **Results panel doesn't use the space when the keyboard is hidden.** About 2½ rows stay visible with a large empty map area below. | Before/after hiding the keyboard. | Let the panel grow to the keyboard-less height. |
| B7 | **Saved list issues.** Stale scroll position (Home/Work scrolled away on reopening). "Work" is repeated as "226 Antigua Street · 15 trips". "Home" is offered as a stop when driving from home. | Saved places screens. | Reset scroll on open, merge a frequent place that equals a saved one, hide the current origin. |
| B8 | **Music card shifts when album art loads**, moving Pause/Next/volume under the finger (I skipped tracks by mistake). | Layout differs between "No playback" and "playing" states. | Fixed-position transport buttons. |
| B9 | **Add-stop preview goes stale.** The car keeps driving beneath a zoomed-out, static preview. "9 min · 5.2 km" doesn't say it is to the stop. | Preview screenshot. | Keep a live "to stop / extra" split, follow the car, auto-expire the preview. |
| B10 | Truncated address "Main North Road and, Christchurch". | Fuel list. | Trim or format addresses before display. |
| B11 | **"Fastest 25 min / 16.1 km" vs "Shortest 25 min / 12.5 km"** — the same time, so "fastest" means little and the shorter route looks like the obvious choice. | Work route preview. | Default to the shorter when times tie, or label by difference ("Same time, 3.6 km shorter"). |
| B12 | The quick-stop row stays open for the whole drive and uses vertical space. | Remained open for the full test. | Auto-collapse after a few seconds. |

### C. Ambiguous UI

1. **Mute button** shows the *current* state (slashed = muted) with no label. Guidance **started muted** from a previous session with no cue; the first spoken turn would be silent. Show "Voice off" on start and when toggled.
2. **Camera button** switches between an arrow and a compass; neither says "heading up" or "north up".
3. **Fan / warmth chevrons ‹ ›** — which direction is "more"? Use −/+ (or a labelled step).
4. **Dock icons** (airflow, recirculate, rear demist, A/C) have no text. The on-state is a blue icon with a thin underline, easy to miss at a glance.
5. **"Mapbox online"** looks like a status but is a toggle to local routing.
6. **"Resume / Wait for me"** (Music on start) — unclear. Try "Start music automatically / Ask me first".
7. **Avoid chips** (Tolls, Ferries, Unpaved): nothing shows whether highlighted means "avoid".
8. **"Preview" chip** and **"sim."** speed bubble are dev concepts in the status bar.
9. **Warmth 5/10** is a blend, not a temperature. Fine, but say Cool/Warm at the ends only (already done) and consider a legend.
10. **Navigate vs Add stop**: the same bar changes meaning with state; the top-left buttons also change (Home/Work disappear during preview).

### D. Missing or worth considering

- **Screen brightness / dimming** (Display tab only has time of day and map weather).
- **Front windscreen demist** as a one-tap action. Only rear demist is present; windscreen is buried in the airflow cycle.
- **Voice destination entry** (already noted in earlier reviews).
- **Mini now-playing bar inside Library** — transport controls are hidden while browsing.
- **Passenger awareness** — a way for the passenger to do the things the driver can't, without unlocking them for the driver.
- **Post-arrival actions** — Done only; consider "Find parking", "Save as Home/Work" and the walking-distance hint.
- **Spoken confirmation** for stop added / route changed / voice muted.
- **Parked-only advanced route options** surfaced at preview time (avoid tolls) rather than only in Settings.

## Verified not to be bugs

- First touch after a pause occasionally didn't register in my injected-touch setup, then worked on repeat; the dock uses plain `onClick`. Treated as a test-tool artifact.
- The simulation looked very slow for a while because the renderer was throttled when the window was in the background (0.3 fps measured, 30 fps once active).

## Limits of this run

- The viewport was 1080 × 1465 (the window size), not the 1080 × 1920 panel. The real display has more map.
- Spoken guidance, ducking and the natural voice were not audible to me. Hardware (vehicle bus, GPS, audio out), real reach and glare, night/dusk themes, rain/snow, and offline routing were not exercised.
- Spotify here used an external device that was not running, so real playback behaviour on the NUC is unverified.
- Two events I could not attribute to my own input: a route (7 min, 3.0 km) started once after I tapped Done on the arrival card; and music was playing again after I paused it. Another controller (possibly yours) may have been active.

## State I changed and restored

Climate settings restored to fan 3, warmth 5, airflow face, A/C, recirculate and rear demist off. Stored guidance mute put back to **muted**. Spotify: I started a playlist, skipped tracks by mistake, paused it, and tried lowering the volume; Spotify was playing again at volume 20 when I finished, so check your playback state. Nothing was committed.
