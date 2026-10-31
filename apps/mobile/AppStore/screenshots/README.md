# App Store screenshots

The `de-DE` and `en-US` folders contain upload-ready RGB PNGs: six iPhone screenshots at 1320 × 2868 and five iPad screenshots at 2064 × 2752 per locale. `raw` contains the original simulator captures. `manifest.json` records each final image and its SHA-256 checksum.

## Render again

On macOS, install `requirements.txt` in a Python virtual environment, then run:

```sh
python render.py
```

The renderer uses the system Arial fonts, captured app screens, rounded frames and generated backgrounds. It does not synthesize app UI. Headline copy and layout are defined in `render.py`.

## Capture again

Build the Debug configuration with XcodeGen and Xcode, install it on an iPhone 17 Pro Max and iPad Pro 13-inch simulator, then launch `com.ais.orbit-mobile` with `-OrbitDemo`. The demo seed is compiled only in Debug. It creates fictional spaces, pins, folders and a Mac device, opens public NASA, Swift and Wikipedia pages, and disables search suggestions. It neither connects to a real sync folder nor reads personal browsing data.

Use T3 `device_list`, `device_open` and the returned `agent-device` command. Launch through that command, interact with the visible app, and capture PNGs at pixel density 3 for iPhone and 2 for iPad. Use `device_screenshot` to inspect the device. Do not substitute simctl for UI or screenshots.

Capture the NASA Solar System page with the full bottom address bar, the collapsed pill after scrolling, the populated tab overview, Devices & Spaces, the Discover theme editor and the app-icon picker. On iPad, capture the sidebar with three pin columns, a full-width page with the sidebar hidden, and the three settings sheets. There is no iPad tab-overview image in this set. Wait for pages and thumbnail updates to settle; dismiss transient website banners before capturing when possible. Public website content can change.

Keep the existing filenames in `raw/iphone` and `raw/ipad`, rerun the renderer, and visually inspect every output. Only upload the PNGs inside locale/device folders. The optional `overview.png` is a review contact sheet, not a store asset.

Shut down only simulators started for this work and close only task-owned tabs and apps.
