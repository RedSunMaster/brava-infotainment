# Spotify in the car

The app does not play audio itself. It controls a Spotify player, and on the car computer that player is
**spotifyd**, a small background program that shows up in Spotify as a device called **Brava** and plays
through the car's sound system. It needs Spotify Premium.

Once it is set up, nothing is needed at the start of a drive:

- The app keeps its Spotify sign-in (a saved refresh token, renewed in the background).
- When nothing is active, pressing play, or picking a song or playlist in the Library, starts it on **Brava**.

## One-time setup (Linux)

1. Install spotifyd (your distribution's package, or a release from the spotifyd project). Version 0.3.5 or
   newer is needed for the sign-in below.
2. Copy `deploy/spotifyd/spotifyd.conf` to `~/.config/spotifyd/spotifyd.conf`, and
   `deploy/spotifyd/spotifyd.service` to `~/.config/systemd/user/spotifyd.service`.
3. Start it and make it start at boot:

   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now spotifyd
   loginctl enable-linger "$USER"
   ```

4. Sign in once: open Spotify on your phone while it is on the same network as the car computer, tap the
   speaker icon (Connect devices), and choose **Brava**. spotifyd remembers the account in `~/.cache/spotifyd`.
5. In the Brava app, tap the music card and connect Spotify once. After that it stays connected.

## On Windows (development)

There is no spotifyd setup for Windows, and none is needed for testing. If no device is called **Brava**, the app
uses whatever is already active, then any computer running Spotify, then any other device. So:

1. Install and open the Spotify desktop app (it can stay in the background) and sign in.
2. Connect Spotify in the Brava app once. After that it stays connected.
3. Press play in Brava, or pick something in Library. It starts in the desktop app.

If you want a Windows test that behaves like the car, build `librespot` (`cargo install librespot`), run it with
`librespot --name Brava`, and sign in once from your phone as in step 4 above.

## Settings

- The device name is `Brava`. If you change `device_name`, set `SPOTIFY_DEVICE_NAME` in `.env` to match.
- If the car has no PulseAudio or PipeWire, set `backend = "alsa"`.
- Spotify's own `librespot` works the same way if spotifyd is not available for your distribution.

## If it does not play

- `systemctl --user status spotifyd` should say active. `journalctl --user -u spotifyd` shows why not.
- Open Spotify on your phone: **Brava** should be listed under Connect devices. If not, repeat step 4.
- This was written and checked against the app's code, but not run on the car computer. Treat the config
  as a starting point.

## Which player is used

The app can also play inside its own window. That player shows up in Spotify as **Brava**, the same name as the car's own device, so Spotify
shows "Playing on Brava" whichever one is playing. The app tells them apart by device id: when the car's own Brava (spotifyd) is online,
new songs, playlists and episodes go to it, even if the app's own player is on; the in-app player is used only when no other Brava is found.
If you run both at once, Spotify on your phone will list two devices called Brava; turn the in-app player off in Settings > Sound > Music player
to avoid the duplicate.
