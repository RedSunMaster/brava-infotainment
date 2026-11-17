import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keyboard = { hideKeyboard() {}, showKeyboard() {}, isVisible: false };
function load(relative) {
 const path = resolve(root, relative);
 const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
 const module = { exports: {} };
 const localRequire = name => {
  if (name === "electron") return { ipcRenderer: { send() {} } };
  if (name.endsWith("KeyboardContext")) return { useKeyboard: () => keyboard };
  if (name.endsWith("ThemeContext")) return { useThemeMode: () => ({ preference: "auto", setPreference() {}, reason: "Daylight", weatherAppearance: "auto", setWeatherAppearance() {} }) };
  if (name.endsWith("useSpotify")) return { useSpotify: () => ({ isConnected: false, track: null, volume: 50 }) };
  if (name.endsWith(".svg")) return () => React.createElement("svg");
  if (name.startsWith(".")) {
   const target = resolve(dirname(path), name);
   const file = [target, target + ".ts", target + ".tsx"].find(existsSync);
   return load(file);
  }
  return require(name);
 };
 new Function("require", "module", "exports", compiled)(localRequire, module, module.exports);
 return module.exports;
}
const { getTheme } = load("src/theme.ts");
function luminance(hex) {
 const channels = hex.replace("#", "").match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
 return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x,y) + .05) / (Math.min(x,y) + .05); }
test("day and night primary labels and filled buttons retain readable contrast", () => {
 for (const mode of ["light", "dark"]) {
  const { palette } = getTheme(mode);
  for (const background of [palette.background.default, palette.background.paper]) assert.ok(contrast(palette.primary.main, background) >= 4.5);
  assert.ok(contrast(palette.primary.main, palette.primary.contrastText) >= 4.5);
 }
});
test("navigation options retain secondary actions and avoid duplicate recenter", () => {
 const MapControls = load("src/components/MapControls.tsx").default;
 const render = (active, cameraMode = "following") => renderToStaticMarkup(React.createElement(MapControls, { orientation: "heading", cameraMode, hasRoute: active, isNavActive: active, isDriving: active, panel: null, setPanel() {}, currentPosition: [172,-43], mapboxToken: "", provider: "mapbox" }));
 const idle = render(false), moving = render(true);
 // One view button: it switches orientation while following, and recentres once the map has been moved away.
 assert.ok(render(false, "overview").includes('aria-label="Centre on location"'));
 assert.ok(!idle.includes('aria-label="Centre on location"'));
 assert.ok(!moving.includes('aria-label="Centre on location"'));
 assert.equal((idle.match(/map-action/g) ?? []).length, 3, "settings, view and destination only");
 for (const label of ["Switch to north up", "Open settings"]) assert.ok(idle.includes('aria-label="' + label + '"'));
 // On a trip, settings only appear while parked: it is disabled when moving, so it would just take up room.
 assert.ok(!moving.includes('aria-label="Open settings"'));
 const parkedTrip = renderToStaticMarkup(React.createElement(MapControls, { orientation: "heading", cameraMode: "following", hasRoute: true, isNavActive: true, isDriving: false, panel: null, setPanel() {}, currentPosition: [172,-43], mapboxToken: "", provider: "mapbox", quickStops: React.createElement("span", { id: "stops" }) }));
 assert.ok(parkedTrip.includes('aria-label="Open settings"'));
 assert.ok(parkedTrip.includes('id="stops"'), "quick stops sit in the Add stop row");
 // While navigating, map orientation is one tap away on the trip card instead.
 assert.ok(!moving.includes('aria-label="Switch to north up"'));
 assert.ok(!idle.includes('aria-label="Route overview"'));
 assert.ok(moving.includes('aria-label="Route overview"'));
 assert.ok(moving.includes('aria-label="Add a stop"'));
 assert.ok(moving.includes('Add stop'));
 // A stop can be added on the move.
 assert.doesNotMatch(moving, /<button[^>]*disabled[^>]*aria-label="Add a stop"/);
 // Off a trip, moving still disables settings.
 const movingIdle = renderToStaticMarkup(React.createElement(MapControls, { orientation: "heading", cameraMode: "following", hasRoute: false, isNavActive: false, isDriving: true, panel: null, setPanel() {}, currentPosition: [172,-43], mapboxToken: "", provider: "mapbox" }));
 assert.match(movingIdle, /<button[^>]*disabled[^>]*aria-label="Open settings"/);
});
test("dock: warmth and fan steppers, five icon-only switches and a way into the player", () => {
 const Controls = load("src/components/CarControls.tsx").default;
 const html = renderToStaticMarkup(React.createElement(Controls, { isDriving: false, panel: null, setPanel() {} }));
 for (const label of ["Decrease warmth", "Increase warmth", "Decrease fan", "Increase fan"]) assert.ok(html.includes('aria-label="' + label + '"'), label);
 // The switches are icon-only: each has an accessible name and pressed state but no visible text.
 for (const name of ["Air conditioning", "Recirculate cabin air", "Rear demist", "Hazard lights"]) assert.match(html, new RegExp('<button[^>]*aria-label="' + name + '[^"]*"[^>]*aria-pressed="false"'), name);
 // The fan direction is one button beside Fan that steps through the settings, starting at the face.
 assert.match(html, /aria-label="Airflow direction: face[^"]*"/);
 assert.ok(html.indexOf('aria-label="Decrease fan"') < html.indexOf('aria-label="Airflow direction'), "direction follows Fan");
 // The air switches run demist, then A/C, with the hazards last at the driver's end of the bar.
 const order = ["Rear demist", "Air conditioning", "Hazard lights"].map(name => html.indexOf('aria-label="' + name));
 assert.deepEqual([...order].sort((a, b) => a - b), order, "hazards come last, after the climate switches");
 for (const word of [">Media<", ">Climate<", ">Demist<", ">Hazards<"]) assert.ok(!html.includes(word), "no text labels: " + word);
 assert.ok(!html.includes('id="dashboard-panel"'));
 // The music strip is the way in to the player, and is there even before an account is linked.
 assert.ok(html.includes("Connect Spotify"));
 const media = renderToStaticMarkup(React.createElement(Controls, { isDriving: false, panel: "media", setPanel() {} }));
 assert.ok(media.includes('id="dashboard-panel"') && media.includes('aria-label="Close music player"'));
 assert.ok(!html.includes("Vehicle controls are a preview"), "no preview line in the dock");
});
test("Spotify connection is unavailable while moving", () => {
 const Media = load("src/components/SpotifyPopup.tsx").default;
 const html = renderToStaticMarkup(React.createElement(Media, { spotify: { isConnected: false }, isDriving: true }));
 assert.match(html, /<button[^>]*disabled/);
 assert.ok(html.includes("Connect Spotify"));
});

test("route overview clears overlays and returns to following", () => {
 const { useCameraMode } = load("src/hooks/useCameraMode.ts");
 let camera;
 const map = { getContainer: () => ({ clientHeight: 1920 }), fitBounds: (_, options) => { camera = options; } };
 let controls;
 function Probe() { controls = useCameraMode({ current: map }); return null; }
 renderToStaticMarkup(React.createElement(Probe));
 controls.showOverview([[172, -43], [173, -44]]);
 assert.equal(controls.followingRef.current, "overview");
 assert.equal(camera.pitch, 0);
 assert.ok(camera.padding.top > 400 && camera.padding.bottom > 400);
 controls.resumeFollowing();
 assert.equal(controls.followingRef.current, "following");
});

test("expanded music player presents artwork and playback controls", () => {
 const Media = load("src/components/SpotifyPopup.tsx").default;
 const track = { name: "A song", artists: "An artist", albumName: "An album", albumArt: "https://example.com/art.jpg", durationMs: 180000, progressMs: 30000, isPlaying: true, shuffle: true, repeat: "track" };
 const html = renderToStaticMarkup(React.createElement(Media, { spotify: { isConnected: true, track, volume: 50 }, isDriving: false }));
 for (const value of ["A song", "An artist", "An album", "art.jpg", "0:30", "3:00", 'aria-label="Pause music"', 'aria-label="Previous track"', 'aria-label="Next track"', 'aria-label="Shuffle"', 'aria-label="Repeat track"', 'aria-label="Spotify volume 50%"', 'aria-label="Browse library"']) assert.ok(html.includes(value), value);
});

test("camera offset keeps the puck the same distance above an open panel as above the dock", () => {
 const { offsetForPanels } = load("src/hooks/useMapOcclusion.ts");
 const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);
 assert.equal(offsetForPanels(1000, []), 0.2);
 // A panel whose top is at 600 px, with the puck 300 px above it: the puck sits at 300 px, a fifth above the middle.
 near(offsetForPanels(1000, [600], 300), -0.2);
 // The gap is the same whatever the panel height, so a taller panel moves the puck up by exactly the extra height.
 near(offsetForPanels(1000, [500], 300) - offsetForPanels(1000, [600], 300), -0.1);
 // A low panel never pushes the puck below its normal place; a very tall one never lifts it above a tenth of the way down.
 assert.equal(offsetForPanels(1000, [1100], 300), 0.2);
 assert.equal(offsetForPanels(1000, [100], 300), -0.4);
 // With several panels the highest one decides.
 near(offsetForPanels(1000, [800, 500], 300), -0.3);
});
test("frequent destinations persist, rank and ignore invalid stored data", () => {
 const saved = new Map();
 globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
 const { readFrequentPlaces, recordFrequentPlace } = load("src/lib/frequentPlaces.ts");
 recordFrequentPlace("Airport", [172, -43]); recordFrequentPlace("Home", [173, -44]); recordFrequentPlace("airport", [172, -43]);
 assert.deepEqual(readFrequentPlaces().map(place => [place.name, place.visits]), [["Airport", 2], ["Home", 1]]);
 recordFrequentPlace("Invalid", [200, 0]); assert.equal(readFrequentPlaces().length, 2);
 saved.set("brava-frequent-places", "broken"); assert.deepEqual(readFrequentPlaces(), []);
 delete globalThis.localStorage;
});

test("search and media show only their selected panel", () => {
 const MapControls = load("src/components/MapControls.tsx").default;
 const Controls = load("src/components/CarControls.tsx").default;
 const props = { orientation: "heading", hasRoute: false, isNavActive: false, isDriving: false, currentPosition: [172,-43], mapboxToken: "", provider: "mapbox", setPanel() {} };
 const search = renderToStaticMarkup(React.createElement(MapControls, { ...props, panel: "search" })) + renderToStaticMarkup(React.createElement(Controls, { isDriving: false, panel: null, setPanel() {} }));
 assert.ok(search.includes('aria-label="Destination search"')); assert.ok(!search.includes('aria-label="media controls"'));
 const media = renderToStaticMarkup(React.createElement(MapControls, { ...props, panel: null })) + renderToStaticMarkup(React.createElement(Controls, { isDriving: false, panel: "media", setPanel() {} }));
 assert.ok(!media.includes('aria-label="Destination search"')); assert.ok(media.includes('aria-label="media controls"'));
});

test("shuttle GLB includes the texture used by its material", () => {
 const glb = readFileSync(resolve(root, "public/models/space_shuttle.glb"));
 assert.equal(glb.toString("ascii", 0, 4), "glTF");
 const jsonLength = glb.readUInt32LE(12);
 const model = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
 const primitive = model.meshes[0].primitives[0];
 assert.ok(Number.isInteger(primitive.attributes.TEXCOORD_0));
 const index = model.materials[primitive.material].pbrMetallicRoughness.baseColorTexture.index;
 const image = model.images[model.textures[index].source];
 assert.equal(image.mimeType, "image/jpeg");
 assert.ok(Number.isInteger(image.bufferView));
});

test("settings offers independent time and map-weather choices", () => {
 const MapControls = load("src/components/MapControls.tsx").default;
 const props = { orientation: "heading", hasRoute: false, isNavActive: false, isDriving: false, currentPosition: [172,-43], mapboxToken: "", provider: "mapbox", panel: "settings", setPanel() {} };
 const html = renderToStaticMarkup(React.createElement(MapControls, props));
 for (const label of ["Display", "Sound", "Driving", "System", "Time of day", "Map weather", "Clear", "Rain", "Snow"]) assert.ok(html.includes(label), label);
 // Settings is tabbed: Routing and Exit app live on the System tab, not on the Display tab shown first.
 for (const hidden of ["Routing", "Exit app"]) assert.ok(!html.includes(hidden), hidden);
});


test("guidance prioritizes distance while preserving full turn instructions", () => {
 const Card = load("src/components/NavigationCard.tsx").default;
 const { ThemeProvider } = require("@mui/material/styles");
 const instruction = "At the roundabout, take the second exit onto Main Street.";
 const maneuvers = [{}, { instruction, length: 1, time: 60, type: "roundabout", begin_shape_index: 1 }];
 const html = renderToStaticMarkup(React.createElement(ThemeProvider, { theme: getTheme("dark") }, React.createElement(Card, { maneuvers, currentStep: 0, distanceToNextM: 245, timeToNextS: 60, isDriving: true })));
 assert.ok(html.includes("245 m"));
 assert.ok(html.includes(instruction));
 assert.ok(html.indexOf("245 m") < html.indexOf(instruction));
 assert.ok(!html.includes("1 min"));
});

test("trip summary exposes recenter, options state and a distinct end action", () => {
 const Trip = load("src/components/TripInfoCard.tsx").default;
 for (const toolsOpen of [false, true]) {
  const html = renderToStaticMarkup(React.createElement(Trip, { maneuvers: [], currentStep: 0, isDriving: true, toolsOpen, onToggleTools() {}, onLocate() {}, onEndNav() {} }));
  for (const label of ["Centre on location", "Navigation options", "End navigation"]) assert.ok(html.includes('aria-label="' + label + '"'));
  const withOrientation = renderToStaticMarkup(React.createElement(Trip, { maneuvers: [], currentStep: 0, isDriving: true, orientation: "heading", onToggleOrientation() {}, onEndNav() {} }));
  assert.ok(withOrientation.includes('aria-label="Switch to north up"'));
  assert.ok(html.includes('aria-expanded="' + toolsOpen + '"'));
  assert.equal(html.includes('aria-controls="navigation-options"'), toolsOpen);
 }
});

test("turn instructions shorten to a glanceable road name", () => {
 const { glanceLabel } = load("src/lib/maneuverText.ts");
 assert.equal(glanceLabel("Turn left onto Millstream Drive."), "Millstream Drive");
 assert.equal(glanceLabel("Head north on Brookwater Avenue."), "Brookwater Avenue");
 assert.equal(glanceLabel("At the roundabout, take the second exit onto Main Street."), "2nd exit · Main Street");
 assert.equal(glanceLabel("Enter the roundabout and take the 3rd exit."), "3rd exit");
 assert.equal(glanceLabel("Your destination is on the left."), "Your destination is on the left");
 assert.equal(glanceLabel("Make a U-turn."), "Make a U-turn");
});

test("guidance card shows the short road name while keeping the full instruction for assistive tech", () => {
 const Card = load("src/components/NavigationCard.tsx").default;
 const { ThemeProvider } = require("@mui/material/styles");
 const instruction = "Turn left onto Millstream Drive.";
 const maneuvers = [{}, { instruction, length: 1, time: 60, type: "turn", begin_shape_index: 1 }];
 const html = renderToStaticMarkup(React.createElement(ThemeProvider, { theme: getTheme("dark") }, React.createElement(Card, { maneuvers, currentStep: 0, distanceToNextM: 245, isDriving: true })));
 assert.ok(html.includes(">Millstream Drive<"));
 assert.ok(html.includes(instruction));
});

test("home and work shortcuts persist and reject invalid data", () => {
 const saved = new Map();
 globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
 const { readSavedPlaces, savePlace } = load("src/lib/savedPlaces.ts");
 assert.deepEqual(readSavedPlaces(), {});
 savePlace("home", " 1 Example Street ", [172.6, -43.5]);
 savePlace("work", "Office", [200, 0]);
 assert.deepEqual(readSavedPlaces(), { home: { name: "1 Example Street", coords: [172.6, -43.5] } });
 savePlace("work", "Office", [172.7,-43.5], [172.701,-43.501]);
 assert.deepEqual(readSavedPlaces().work.buildingCoords, [172.701,-43.501]);
 saved.set("brava-saved-places", "broken"); assert.deepEqual(readSavedPlaces(), {});
 delete globalThis.localStorage;
});

test("home and work are icon shortcuts: one tap to go, or a prompt to set them", () => {
 const Quick = load("src/components/QuickDestinations.tsx").default;
 const html = renderToStaticMarkup(React.createElement(Quick, { saved: { home: { name: "1 Example Street", coords: [172, -43] } }, onGo() {}, onSet() {} }));
 for (const label of ["Navigate home", "Set work address"]) assert.ok(html.includes('aria-label="' + label + '"'), label);
 assert.ok(!html.includes("Airport"), "frequent places are left to the search panel");
});
