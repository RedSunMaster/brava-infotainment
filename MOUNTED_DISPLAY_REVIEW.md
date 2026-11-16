# Mounted-screen usability and end-to-end review

Date: 16 November 2026. Target: Verbatim 49592 PMT-15, 15.6-inch FHD touch display, mounted portrait to the left of a right-hand-drive driver as shown in the supplied image.

## Scope and verdict

Tested the running Electron preview at 1080 × 1920, 141.2 PPI, 100% target scaling. The desktop preview is fit-to-window: screenshots are not proof of installed physical readability. The panel active area is approximately 194 mm wide × 345 mm tall, calculated from the diagonal and 16:9 aspect ratio. Eye distance, installed tilt, hand reach, glare and actual touch mapping remain unmeasured.

Recommendation: retain the routing, weather, theme and simulation logic; redesign the screen composition around the mounted driver's view. A full application rewrite is unnecessary. The current almost-full-height map pushes frequent actions to the lowest part of the display.

## Evidence from this session

| Flow | Result | Boundary |
| --- | --- | --- |
| Startup and dashboard | Pass: loaded map, current weather, GPS Lost indication and persistent controls | No actual GPS fix was available |
| Destination entry | Search panel and touch keyboard opened; entered Christchurch Airport through the accessible input | Individual on-screen key entry was not exercised |
| Search results | Returned eight businesses associated with the airport; no clear airport terminal result | Relevance failure for this public destination, despite successful service response |
| Route preview | Selected Sudima Christchurch Airport; displayed 12 min / 7.9 km route and Start/Cancel | This is a hotel route, not airport-terminal validation |
| Start and simulation | Pass: moving map, changing distances and successive Millstream Drive / Watermill Boulevard / Hussey Road instructions | Simulation, not real driving; did not run the full route to arrival |
| Moving-state restrictions | Add-stop and Settings controls disabled; search/keyboard no longer visible | Production GPS-loss recovery and speed thresholds not exercised live |
| Climate while moving | Panel opened and closed; main turn instruction remained visible | Panel obscured ETA/end-route area; hardware commands not tested |
| End navigation | Explicit Keep route / End route confirmation worked; returned to idle dashboard | Two-step confirmation retained |
| Theme switching | Day changed UI and Mapbox lighting; Auto restored night at the same location | Rain/snow visual rendering not exercised in this review |
| Media disconnected state | Playback actions visibly disabled; Connect Spotify shown | Authentication, playback and speakers not tested |
| Automated regression tests | 25/25 passed across ambient appearance, map appearance, display calibration and location search | These are logic tests, not 25 UI flows |

Preview left open, route stopped, appearance restored to Auto. Search history now includes the test query. No application source was changed during this review.

## Findings in priority order

1. **Frequent controls are too low for this proposed mounting position.** The lower three rows contain music, warmth/fan, demist/hazards and navigation actions. The image places them near the gear lever. Exact reach discomfort cannot be inferred from a rendering, but the composition requires a large downward visual movement.
2. **Day-mode control contrast is poor.** Source colours #FFB000 against #D3DAE2 and #E2E7ED yield approximately 1.30:1 and 1.47:1 contrast respectively. Visually confirmed pale amber text/icons on light surfaces. Use dark foregrounds for light-mode outlined/text buttons; retain amber for filled emphasis with dark labels.
3. **Climate covers trip status and end navigation.** Keep maneuver, ETA and route actions in a protected upper area. Panels should replace a dedicated content area rather than overlap important information.
4. **“Stop” is ambiguous.** During navigation it means Add a stop, is disabled while moving, and is distinct from the X used to end navigation. Label it “Add stop”; use an explicit “End route” action in the route panel.
5. **Control locations change between idle and navigation.** Route overview and repeat/mute instructions add buttons to the bottom flex row, shifting existing actions. Give frequently used controls fixed positions across states.
6. **Search quality still needs work.** Christchurch Airport returned car rental, restaurants, hotel, exchange and parking. Prefer the terminal/main destination when the query names the airport, but show addresses and require user selection rather than silently substituting an associated business.
7. **Physical touch targets are not the main size problem.** The shared target reaches 112 logical px at this width, approximately 20.1 mm at 141.2 PPI and 100% scaling. Yet 22–30 px labels occupy only about 4.0–5.4 mm em height, with actual glyphs smaller. Increase primary information selectively, not every component uniformly. Verify actual OS scaling and touch alignment on the rotated panel.
8. **Vehicle controls are UI-only.** CarControls stores warmth, fan, A/C, airflow, rear demist and hazards in React state, with no vehicle acknowledgement path. Do not treat a highlighted switch as proof of actuation. Keep physical hazard/demist controls available; introduce unavailable/pending/confirmed state when hardware integration exists.
9. **Map detail competes with route guidance.** Buildings, POIs and local labels dominate a large screen area. Reduce irrelevant map detail while navigating and keep the route and next maneuver visually dominant. Weather effects should remain subtle or be suppressible in driving view.

## Proposed composition to prototype

Top to bottom, for this portrait right-hand-drive installation:

| Zone | Approximate height | Content |
| --- | --- | --- |
| Glance area | 18% (~62 mm) | Large maneuver arrow, distance, short road name; ETA and remaining time on the same panel. Compact clock/GPS status. No popup may cover this. |
| Navigation area | 42% (~145 mm) | Reduced-detail map and route ahead. Small fixed driver-side controls for recenter and repeat instruction. |
| Main action area | 25% (~86 mm) | Stable Navigation / Media / Climate destinations; large media or climate controls. Place frequent controls nearer the right edge, subject to a stationary left-hand reach test. |
| Lower secondary area | 15% (~52 mm) | Parked-only settings and infrequent details. Avoid putting the only instance of an essential control at the bottom. |

These percentages are a prototype starting point, not a physical ergonomic certification. Place a full-scale paper mockup on the installed display and adjust the action band's height before coding the full redesign.

A tactile volume/mute control, accessible physical hazard switch and physical demist access would reduce dependence on precise screen tapping. Retain the existing direct fan/warmth steps where appropriate; do not replace simple actions with deep menus. Use actual temperature units only if the hardware measures/controls temperature; otherwise label it Cool/Warm rather than implying degrees.

## Smallest sensible implementation sequence

1. Fix day contrast and ambiguous Add stop text; stabilise action positions and protect ETA/navigation from overlays.
2. Recompose existing App, NavigationCard, TripInfoCard, CarControls and MapControls into the zones above. Reuse DriveButton, search, keyboard, map and theme logic.
3. Improve destination relevance and short confirmation labels; move full address detail into parked-mode review.
4. Add genuine hardware acknowledgement/error states separately from the layout work. Verify master audio versus Spotify-only mute.
5. Repeat live flows at native display scaling, then test the mounted setup while stationary.

## Remaining end-to-end checks

- Stationary seated reach without leaning; steering-wheel and gear-lever interference; left-hand occlusion of feedback; road sightlines.
- Native portrait rotation and touch calibration, sleep/wake and reconnect.
- Daylight reflection and night brightness on the physical monitor; measure rather than infer from the screenshot.
- Actual GPS fix/loss/recovery, arrival, rerouting and network outage recovery.
- Spotify sign-in/playback, spoken navigation audio and media ducking; repeat/mute interactions.
- Vehicle command acknowledgement, unavailable hardware, startup state and reboot persistence.
- Rain/snow visual readability with an active route; weather stale-data clearing has logic-test coverage only.

## Sources

- Verbatim PMT-15: https://www.verbatim.com/en/monitors/products/49592-portable-touchscreen-monitor-full-hd-1080p-156-metal-housing-pmt-15?country=CA
- Google automotive interaction principles: https://developers.google.com/cars/design/design-foundations/interaction-principles
- Google automotive sizing: https://developers.google.com/cars/design/automotive-os/design-system/sizing

Google's platform guidance supports glanceability, easy touch targets and consistent interaction; its dp dimensions are not a direct physical certification of this standalone Electron UI. Findings above distinguish observed preview behaviour, source inspection and proposed ergonomic changes.
