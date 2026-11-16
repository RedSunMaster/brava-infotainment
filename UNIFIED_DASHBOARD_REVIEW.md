# Unified dashboard — reassessment checklist

Implemented 16 November 2026 for the portrait 1080 × 1920 / 15.6-inch display.

- Guidance, ETA, route confirmation and route errors now occupy a separate upper area, outside the map and lower workspace.
- Navigation / Media / Climate tabs share one fixed lower workspace. Main tabs support keyboard navigation through MUI Tabs.
- Navigation actions retain their positions; unavailable actions stay disabled. Add stop and End route have explicit labels.
- Media controls use the dashboard theme and large controls rather than the old floating Spotify popup. Playback, next and mute remain persistent. Previous, repeat, shuffle, volume and library remain available in Media. Connection and browsing are disabled while moving.
- Climate occupies its own workspace rather than covering ETA. Vehicle preview status is explicit; no hardware control was added.
- Map POI labels and 3D objects are reduced. Mapbox lighting/weather and route integration remain. A ResizeObserver updates the map viewport as guidance changes.
- Daytime primary labels and filled-button text pass a 4.5:1 contrast assertion against their theme surfaces.
- Destination search remains parked-only. Its keyboard occupies the bottom of the screen; route confirmation uses a prominent destination name with secondary address detail.

## Please reassess

1. Open Navigation and search a public destination. Check the keyboard, result scrolling, short destination heading and Start/Cancel.
2. Start the simulated route. Check turn text, ETA and End route remain visible when switching to Media and Climate; search/settings should be disabled while moving.
3. Check tabs and action buttons stay in fixed places across idle/navigation. Check all actions fit or scroll within their workspace.
4. Try Day, Night and Auto in Settings. Assess real installed brightness separately from the theme.
5. Test Spotify connection/playback/library while parked, including volume and failure feedback. These were not authenticated or exercised in this implementation pass.
6. At the installed display, check left-hand reach, reading distance and gear-lever clearance. The target model is retained at 141.2 PPI / 100% scaling; desktop fit mode is not a physical reach test.

Automated coverage: 29 passing tests across dashboard contrast/rendered controls, solar/weather appearance, map appearance, display scaling and search logic. TypeScript and ESLint pass. No final visual or hardware verification was performed after the request to stop computer interaction. No commit or push was made.

Remaining known limitations: airport search relevance is unchanged; vehicle controls remain local preview state; GPS, audio and real vehicle behaviour require hardware testing.
