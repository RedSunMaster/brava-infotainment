# In-car interaction review — 8 October 2026

Reviewed the running Electron preview at 1080 × 1920, 141.2 target PPI, 100% target scaling, physically calibrated to the owner's 81.6 PPI desktop. Intended installation: centre console, operated with the left hand. Exact installed height, viewing angle, seated reach and steering side remain unmeasured. No application code was changed for this review.

## Assessment

The map, persistent lower control bar, route overview and automatic follow camera are useful foundations. Search returned results, a selected destination produced a route preview, and navigation simulation displayed advancing instructions. However, the interface currently has desktop-sized detail, fragmented popups and incomplete vehicle control. It needs a consistent driving dashboard and reliable state handling before it can offer the everyday predictability of CarPlay or Android Auto.

Live inspection covered the dashboard, fan popup, vehicle-function popup, keyboard, search results, destination confirmation, active navigation and ending navigation. Hardware actuation, authenticated Spotify playback, real GPS, offline operation, microphone and mounted-car reach were not tested. Findings about those paths below come from current source inspection.

## Priority findings

| Priority | Evidence | Change |
|---|---|---|
| Before vehicle use | `CarControls.tsx:416` onwards: hazards only animate local state; temperature and fan use local state; rear heat, fog, air direction and A/C handlers log messages. No vehicle command IPC/serial bridge was found in `src`. | Define the controller protocol and reported state. Show pending, acknowledged command, fault and disconnected states. An acknowledgement alone must not be presented as sensor-confirmed physical actuation. Reconcile state after reconnect/reboot. Retain an independently operable physical hazard control and a dependable demisting fallback. |
| Before vehicle use | The live keyboard covers the entire lower bar, including hazards. `InAppKeyboard.tsx:253` fixes it at the bottom with z-index 9999. | Reserve a permanent vehicle-control region outside keyboards, sheets and app screens. Reflow content instead of covering essential controls. |
| Before vehicle use | `App.tsx:417` and `427` start simulation whenever GPS has no fix, without a preview-only condition. Startup also initializes the fixed development origin. | Make simulation explicit and preview-only. Production GPS loss should show a stale/unknown location and age, never fabricated travel. Keep the current route available while waiting for a fix. |
| Before vehicle use | `App.tsx:172` derives driving solely from the latest speed. `MapControls.tsx:207` blocks search only when driving AND navigation is active. Map destination clicks have no driving guard. Ending navigation resets vehicle speed to zero. `useGps.ts` has no silent-stream freshness timeout. | Centralize parked/moving/unknown state, independent of navigation. Add freshness and hysteresis; preferably use a vehicle signal. GPS loss must not imply parked. Restrict typing, deep browsing and map destination selection consistently while moving or movement is unknown. Keep volume, climate, demisting and emergency actions available. |
| High | 58 px map buttons, 56 px search height, 13–15 px search text; 19 px primary navigation text. Trip figures shrink to 13 px and labels to 8.5 px while driving. | Size by physical target and glanceability. Use larger maneuver/distance text and fewer details in driving mode. Never shrink important information when moving. |
| High | Search, orientation, recenter and settings sit at the top; fan/temp/volume popups all anchor to the centre hazard button, regardless of the source control. Live fan popup is a narrow vertical slider. | Put frequent actions in a stable band reachable with the left hand. Open wide sheets adjacent to their invoking control. Use large tap steps for fan/temperature/volume; keep sliders as optional parked adjustment. |
| High | Apps opens vehicle functions rather than apps. Labels include Fog Left/Fog Right and Rear Heat. The dock displays no temperature/fan value. | Separate Navigation, Media and Vehicle. Use familiar names and correct symbols: Rear demist, Airflow, Front fog/Rear fog only after the fitted functions are verified. Show current settings and on/off text without requiring a popup. Temperature 0–10 is a blend setting; label it Cool/Warm rather than implying measured cabin degrees. |
| High | Volume uses Spotify's remote-device API and is disabled when Spotify is disconnected. Playback needs an active Spotify device. No local audio routing, voice recognition, spoken navigation or audio-priority pipeline was found. | Provide master output volume and one-tap mute independently of media provider. Add persistent play/pause/next, spoken directions, repeat instruction and navigation audio ducking. Add microphone-driven destination entry and appropriate phone integration as separate functional work. |
| High | Spotify progress renders a slider with a value but no seek handler. API failures return null; play/pause/shuffle/repeat can still update UI optimistically. No refresh-token storage/refresh path found. | Make progress read-only or implement real seeking for parked use. Separate signed-in, device-ready and offline states. Surface failures, reconcile optimistic state, refresh authentication and restore playback connections after suspend/reboot. Actual NUC audio playback needs verification. |
| High | `handleSearchSelect` replaces route state before confirmation. Cancel clears route/destination. Added stops replace the previous stop array. Trip remaining time/distance sums whole maneuvers rather than remaining progress within the current maneuver. | Keep route previews separate from the active route; cancellation must preserve active navigation. Append/manage stops explicitly. Calculate remaining trip progress and arrival consistently. Test rerouting, arrival, cancellation and network failure. |
| High | Route/search handlers have loading cleanup but limited visible error recovery. Valhalla uses localhost:8002, while search and map resources still use online services. | Preserve last usable route on failure, show concise retry feedback, cancel stale requests and enforce timeouts. “Offline” must distinguish routing availability from map and search availability. Verify local routing data, offline maps and saved destinations independently. |
| Medium | Main dock controls are clickable Boxes with no button semantics or accessible labels; live accessibility tree lists them as groups. Popups mostly rely on click-away dismissal. | Use actual buttons, accessible names, pressed state, visible focus and stable keyboard/rotary order. Provide explicit Back/Close. Use a consistent tap interaction and predictable one-step return to the dashboard. |

## Physical sizing proposal

At 141.2 PPI and 100% target scaling, one CSS pixel corresponds to approximately 0.180 mm. Font sizes below describe the nominal em box, not measured letter height.

| Element | Current nominal size | Physical size | Proposed starting point |
|---|---:|---:|---:|
| Map action | 58 × 58 px | 10.4 × 10.4 mm | 112–136 px / 20–24 mm touch region |
| Main dock touch region | At least 92 × 92 px | At least 16.5 × 16.5 mm | 112–136 px, with visible labels/state |
| Main instruction text | 19 px | 3.4 mm em | 36–44 px / 6.5–7.9 mm em |
| Trip figure while driving | 13 px | 2.3 mm em | 28–36 px / 5.0–6.5 mm em |
| Trip caption while driving | 8.5 px | 1.5 mm em | Remove redundant captions; keep necessary labels legible |
| Keyboard key height | 52 px | 9.4 mm | Parked-only entry; validate larger keys in available width |

These are prototype targets to validate from the seated driver's position, not certification limits. Allow approximately 3–4 mm clear gaps between neighboring frequent actions. Android Auto specifies a 76 × 76 dp minimum; dp is its platform unit and should not be copied as 76 raw pixels on this Electron screen. A 150% scaling prototype is useful for comparison, but needs responsive layouts so cards and menus remain usable.

## Proposed portrait dashboard

| Screen zone | Contents and behavior |
|---|---|
| Upper information zone | Large next maneuver, prominent distance, road name, compact clock and location status. Normally requires no touch. Weather stays secondary. |
| Middle | Map with route ahead, current position and reduced visual clutter. Navigation keeps priority when another panel opens. |
| Reachable action band | Destination/voice, recenter and route options in fixed locations; current media with Play/Pause, Next and Mute. Fixed Navigation / Media / Vehicle destinations with one-tap dashboard return. |
| Permanent vehicle strip | Visible fan level and Cool/Warm setting with large −/+ steps; front demist and rear demist shortcuts where supported. Hazard position remains fixed and unobscured. |

The reachable band should be placed using an installed, stationary reach test, rather than assuming the very bottom is easiest. A low edge near the gear lever may require a downward glance or interfere with shifting. Put high-frequency controls nearest the driver's approach side after confirming the seat/steering arrangement; left-hand operation alone does not establish steering side. Keep state/text above or beside the hand so the forearm does not hide feedback.

## Interaction rules

1. Volume, mute, fan steps, warmth steps and demist should each take one direct action from the driving dashboard. Media pause/next and recenter should also be directly available.
2. Add Home, Work, recent destinations and a few favorites. Full keyboard/search setup belongs in parked mode. In this session, “Christchurch Airport” returned airport-associated businesses rather than a clear airport terminal result, so test destination relevance and addresses before offering a one-tap favorite.
3. Use short, interruptible workflows with stable Back/Home. Replace the tiny timed “Tap again to end” control with a larger explicit confirmation that does not rush the driver.
4. Provide immediate visual feedback, then a clear pending/result state for slower work. Google recommends input response within 0.25 seconds and a loading indication beyond 2 seconds; these timings were not measured in this review.
5. Include voice destination entry and spoken turn prompts with repeat/mute, and lower media during prompts. Setup, pairing and authentication should happen while parked.
6. Keep day/night map behavior, add reliable screen brightness control, persist preferences and test glare, reflections and night brightness in the installed position. Time-of-day map styling already exists; full display brightness/headlight integration does not follow from that.

## Delivery order and verification

1. Correct production GPS/demo behavior, movement restrictions and unobscured essential controls. Define hardware-state and failure behavior.
2. Build the dashboard zones, physical sizing, labeled controls, visible climate values and permanent media actions. Compare 100% and 150% scale in the simulator.
3. Finish command integration, master audio, spoken directions, voice input and reliable media connection. Implement transactional route previews and recovery states.
4. Bench-test hardware acknowledgement, disconnect, repeated commands, reboot and sleep/wake. Test GPS silence/loss/recovery, failed route requests and unavailable media independently.
5. Validate in the mounted car while stationary: normal seated posture, left-hand reach without leaning, sightlines, gear-lever clearance, neighboring-button errors, daylight and darkness. Final reach and legibility conclusions require this test.

This is a standalone vehicle interface proposal based on platform interaction principles. Genuine CarPlay/Android Auto phone projection would be a separate integration project.

## References

- [Apple CarPlay human interface guidelines](https://developer.apple.com/design/human-interface-guidelines/carplay): simplified driving interfaces and familiar, consistent interaction.
- [Android Auto sizing](https://developers.google.com/cars/design/android-auto/design-system/sizing): minimum touch regions and separation of icon size from touch target.
- [Google interaction principles](https://developers.google.com/cars/design/design-foundations/interaction-principles): glanceability, response feedback, interruptible tasks, voice and audio priority.
- Current project source: `src/App.tsx`, `src/components/{CarControls,MapControls,InAppKeyboard,NavigationCard,TripInfoCard,SpotifyPopup}.tsx`, `src/hooks/{useGps,useSpotify,useRoute,useNavigation}.ts`, `src/lib/valhalla.ts`, `src/index.ts`.
- Live navigation evidence: `G:\Documents\ChatGPT\Fiat Brava\brava-navigation-review.png`.
