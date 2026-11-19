# Phone link (Bluetooth)

Notifications from the Pixel appear on the car screen. The **Brava Phone Link** Android app sends them to the car over
Bluetooth; `phone-bridge.py` hands the connection to the Brava app.

```
Pixel (Brava Phone Link) --Bluetooth RFCOMM--> BlueZ --> phone-bridge.py --unix socket--> Brava app (src/phoneLinkMain.ts)
```

## Set up the car computer
```
deploy/phone/install.sh
```
## Set up the phone (once)
1. On the car computer, Settings > Bluetooth: pair the Pixel and mark it trusted.
2. Install the app (`app-debug.apk`), open it, tap **Allow notification access**, **Allow unrestricted battery use**, and allow Nearby devices when asked.
3. Pick the car computer in the list. The status turns to *Connected to the car* when the Brava app is running.

## Checking it
`journalctl --user -u brava-phone-bridge -f` shows "phone connected". Without the Brava app running, connections are refused and the phone keeps retrying.

## Not yet verified on real hardware
Everything here was written without a phone or the car computer to test on. The first run may need fixes.
