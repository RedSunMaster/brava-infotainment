# Monitor simulation

Start Electron in preview mode:

```powershell
$env:BRAVA_DEV_PORT = '3017' # Optional when port 3000 is occupied
npm run start:preview
```

Open **Display → Resolution and PPI…** or press **Ctrl+Shift+D**.

- Enter the monitor's pixel width, height, and PPI. Rotate swaps width and height.
- Set **System scaling** to the scaling used on that monitor: 100%, 125%, 150%, etc.
- **Fit full monitor to desktop** scales the complete target layout to fit the desktop. Resizing the preview scales the same layout instead of changing its breakpoint.
- **Native pixels** uses one desktop physical pixel per target pixel. Large monitors can exceed the desktop's available space.
- **Match physical size** uses target PPI and the entered desktop monitor PPI. Enter the real PPI of the monitor displaying the preview for accurate physical dimensions.

PPI determines physical dimensions, independently of system scaling. The Brava preset targets the owner's **Verbatim 15.6-inch touchscreen monitor**, with a 1920 × 1080, 16:9 panel mounted in portrait (1080 × 1920). [Verbatim's specifications](https://eshop.verbatim.com.hk/en/products/portable-touchscreen-monitor-1080p-metal-housing) confirm the nominal diagonal and resolution. The exact product number has not been supplied; Verbatim also sells a LIGHT series with the same nominal size and resolution.

The preset uses **141.2 PPI**, calculated as `sqrt(1920² + 1080²) / 15.6`, rather than a manufacturer-published density. This corresponds to approximately **194.3 × 345.4 mm** of active display in portrait. At 100% system scaling its layout is 1080 × 1920 CSS pixels; at 150% it is 720 × 1280. The 100% default is a simulation choice; the actual NUC's OS scaling remains unverified.

**Apply** saves the profile across restarts. **Brava: Verbatim 15.6″** fills in 1080 × 1920, 141.2 PPI, 100% scaling, and Fit mode; Apply to save it. Cancel discards form edits.

The owner's desktop display is a **Samsung C27F390**, reported as 27-inch Full HD in portrait (1080 × 1920), giving a calculated **81.6 PPI**. This is the default desktop PPI used for physical-size preview; update it when viewing the preview on another monitor. With this calibration, the Verbatim's active area occupies approximately 624 × 1110 desktop physical pixels. OS display scaling is compensated independently. Physical and native-pixel modes lock window resizing to preserve their scale.

Display simulation is limited to preview mode. Normal fullscreen startup continues to use the installed display. If the operating system constrains a requested native or physical window size, Apply reports an error and restores the previous profile. The simulator uses the desktop's actual refresh rate; it does not emulate the target monitor's refresh rate.

Sizing checks:

```powershell
node scripts/test-display-preview.mjs
```
