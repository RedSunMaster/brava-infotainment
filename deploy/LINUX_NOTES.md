# Notes for the Linux car computer

- **Emoji font.** Map pins for saved places, profile icons and the camera/hazard markers are emoji. Windows has an emoji
  font built in; a minimal Linux install often does not, and they show as empty boxes. Install one, for example
  `sudo apt install fonts-noto-color-emoji` (Debian/Ubuntu) or `sudo dnf install google-noto-emoji-color-fonts` (Fedora),
  then restart the app.
- **Spotify player.** See `SPOTIFY_PLAYER.md`.

## Globe clouds

`public/textures/earth-clouds.webp` is the cloud layer shown on the globe while the app starts. It is made by
`tools/make-cloud-overlay.mjs` from a snapshot of Live Cloud Maps (https://github.com/matteason/live-cloud-maps, CC0;
"Contains modified EUMETSAT data" must stay in the credits, which is in Settings > System). To refresh it with today's clouds:

```
curl -o clouds.jpg https://clouds.matteason.co.uk/images/4096x2048/clouds.jpg
node tools/make-cloud-overlay.mjs clouds.jpg
```

## City lights on the globe's night side

`public/textures/city-lights.webp` is made by `tools/make-city-lights.mjs` from a global "Earth at night" picture (Live Cloud Maps'
`earth-night.jpg`, https://clouds.matteason.co.uk/images/4096x2048/earth-night.jpg, NASA imagery). The tools live in `tools/`, not
`scripts/`, because everything in `scripts/` is run as a test.
