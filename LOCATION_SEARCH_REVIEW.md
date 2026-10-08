# Location search and touchscreen review — 8 October 2026

Reviewed the running Electron app fullscreen on the Verbatim MT15 at 1080 × 1920 portrait. Changes are software only.

## Follow-up correction: Action Indoor Sports

Live requests on 8 October contradict the coverage inference made below: this Mapbox account returns New Zealand POIs. Photon omitted both Christchurch Action Indoor Sports branches, making it unsuitable as the primary business provider. Business search now uses Mapbox Search Box suggestions/retrieval with NZ/proximity filtering and a session token; Photon remains a fallback. Address search remains Geocoding v6.

The exact name returns the Iversen Terrace branch. Hornby is listed under a different name, Action Sports and Leisure Hornby. When an exact query has fewer than two nearby results, a broader phrase is also searched within roughly 50 km. Matching venue categories prevent unrelated businesses from displacing the sports centres. Nearby results rank before distant matches, duplicate IDs merge, and coordinates are retrieved only for the selected result. No business-specific records were hard-coded.

Regression coverage includes the exact Action Indoor Sports query, alternate Hornby naming, separate branch retention, rejection of the unrelated water-sports shop, and retrieve/session pairing. The official business website confirms [Central at 7 Iversen Terrace](https://actionindoorsports.com/christchurch/) and [Hornby at 81 Buchanans Road](https://actionindoorsports.com/hornby/).

## Initial findings and fixes (provider choice superseded above)

- **Search coverage:** the previous Mapbox Search Box endpoint documents support for the US, Canada and Europe, excluding New Zealand. It produced inappropriate results despite the Christchurch proximity bias. Replaced it with Mapbox Geocoding v6 for NZ addresses, streets and towns, and Photon/OpenStreetMap for NZ places and businesses. Both requests restrict the country and use the current search origin.
- **Result relevance:** named bus stops could outrank their associated stores; unrelated streets also appeared for business queries. Results now prioritise matching stores, filter weak matches, retain modest spelling tolerance and deduplicate nearby identical results while preserving different branches.
- **Branch identification:** results now show the address, place type and approximate straight-line distance. The route confirmation retains the branch address. Address routing uses the Mapbox default vehicle-access point when supplied.
- **Touch layout:** replaced the expanding results sheet with a stable panel. Its header/input remain fixed while results scroll. Search moves above the keyboard, preserving the bottom control bar. Added clear, show/hide keyboard and close actions. Enter hides the keyboard without silently picking the first match.
- **Request behaviour:** three-character minimum, 500 ms debounce, obsolete-request cancellation, eight-second search timeout, distinct searching/routing states and recoverable error/retry feedback. A failed provider still allows the other provider's results with a visible limitation. Closing a route request or becoming movement-locked invalidates its result.
- **Recents:** retain user-entered search text and resolve it again, rather than persist temporary Mapbox coordinates. Up to five recent searches.
- **Routing failures:** route requests now time out, reject HTTP/JSON errors and report absent drivable routes instead of hanging or throwing uncaught parse errors.
- **Unrelated blocker:** the Spotify library was mounted even when hidden/disconnected, causing an unhandled API error overlay. It now mounts when opened and connected; read failures and playback failures surface as app feedback.

## Validation

- Live provider checks: Christchurch Airport, 2 Riccarton Road Christchurch and Pak n Save. Airport and street-address results found; PAK'nSAVE store branches precede the bus-stop match.
- Native Electron checks at the actual monitor resolution: keyboard leaves four business results and the bottom controls visible; selecting the Main North Road store produced a 10-minute / 4.9 km preview with its address; full street-address search ranked the exact address first; recent search survived reopening.
- TypeScript and scoped ESLint passed. Fifteen regression checks passed for display geometry, NZ filters, vehicle access points, invalid/foreign results, ranking, branch deduplication, spelling tolerance, partial/complete provider failure and cancellation.

## Remaining limitations and next improvements

- Photon is a fallback public, shared service, permitted for modest usage without availability guarantees. Primary business coverage now depends on Mapbox; fallback coverage depends on OpenStreetMap. A hosted/self-hosted service or commercial NZ POI provider should replace the public endpoint before broader distribution.
- Search requires internet. Current distances are straight-line, with driving distance/ETA supplied after route calculation.
- GPS is absent on this bench setup. The preview's search origin is the demo Christchurch location; these distances do not establish the vehicle's real position.
- Useful next software changes: saved Home/Work/favourites, nearby fuel/parking categories, a larger music panel and improved map destination pins. Voice destination entry remains unimplemented.
- Physical finger accuracy, reach from the driver's seat, audio output and road behavior still need owner testing.

## Sources

- [Mapbox Search Box geographic coverage](https://docs.mapbox.com/api/search/search-box/#supported-geographies)
- [Mapbox Geocoding v6 and result storage](https://docs.mapbox.com/api/search/geocoding/)
- [Photon public-service guidance](https://github.com/komoot/photon#demo-server)
- [Photon country/location filters](https://github.com/komoot/photon/blob/master/docs/api-v1.md)
