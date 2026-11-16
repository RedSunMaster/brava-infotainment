# Automatic map and interface appearance

Settings → Appearance offers Auto (default), Day and Night. The preference survives restart. Both the interface and existing Mapbox Studio styles change during runtime; restarting the app is unnecessary.

Auto calculates solar elevation from UTC date and geographic position using NOAA fractional-year equations. It checks every minute and on window focus/visibility changes. Dawn/dusk use civil twilight (-6° to +6°); night is below -6°. The interface changes to night below the horizon and returns to day above +1°, with a deadband to avoid oscillation.

Shared Open-Meteo weather refreshes every ten minutes and after approximately five kilometres of movement. Fresh fog selects a darker appearance; heavy cloud (at least 85%) with precipitation (at least 0.5 mm in the current interval) does so when the sun is below 20°. Bright midday rain alone does not switch to night. Data older than thirty minutes is ignored, and offline operation retains solar timing. Requests time out after eight seconds and abort when the location changes or the provider unmounts.

Weather is a model estimate, not measured cabin illumination. It cannot automatically detect tunnels. Location follows app position updates; before GPS supplies a location, the app uses its existing Christchurch preview origin. Development `tod` overrides remain available and are identified as Preview in settings.

Style changes retain camera position and restore the location puck and route layers after style load. The style-load callback is independent of React render frequency. Missing nighttime custom styles fall back to Mapbox Dark, rather than Light.

Validation: five solar/weather tests, eleven search tests and six display tests pass; TypeScript and scoped ESLint pass. Fullscreen Electron was inspected with live weather and manual Night then Auto runtime switching.

References: https://gml.noaa.gov/grad/solcalc/solareqns.PDF, https://docs.mapbox.com/mapbox-gl-js/guides/styles/set-a-style/, https://open-meteo.com/en/docs.
