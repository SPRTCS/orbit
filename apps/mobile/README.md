# Orbit for iPhone and iPad

A fast, Arc Search–style browser that pairs with Orbit on the Mac. Your Mac's spaces, pinned tabs and
open tabs show up on the phone, and the phone's open tabs show up on the Mac. No AI features.

- **Browsing:** one WebKit view per tab, full screen. The address bar sits at the bottom: tap it to type,
  swipe it left or right to switch tabs, long-press it for Share, Find on Page, Reader and Copy Link.
  Scrolling down shrinks the bar into a small pill with the site or search; scrolling up, tapping the pill or
  reaching the end of the page brings it back. Swipe up on the bar (or tap the tabs button) and the page
  shrinks into its card in the tab overview. Swipe from the edge to go back or forward, pull down to reload.
- **Address entry:** suggestions from your open tabs, history, your Mac's tabs and pins, and your search
  engine (Google, DuckDuckGo, Bing or Ecosia).
- **Tabs:** a card grid with snapshots; swipe a card left to close it. Devices & Spaces (bottom left) lists
  everything synced from the Mac.
- **iPad, iPhone Duo unfolded, Split View:** at regular width the app switches to an Orbit-for-Mac layout
  with a resizable sidebar (drag its edge; double-tap to reset). Folding or resizing keeps the current tab, its scroll position and anything you're typing.
  Keyboard shortcuts: ⌘T, ⌘⇧T, ⌘W, ⌘L, ⌘R, ⌘[, ⌘], ⌃Tab, ⌃⇧Tab, ⌘F, ⌘S (sidebar).

Open tabs, history and snapshots stay on the device, in Application Support. Background tabs beyond the
six most recent are unloaded to a snapshot and restored from their saved state when you return.

## Build

Requirements: Xcode 26 or later (iOS 26 SDK) and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
cd apps/mobile
xcodegen generate
open Orbit.xcodeproj
```

`Orbit.xcodeproj` is generated from `project.yml` and isn't checked in. From the command line:

```sh
xcodebuild -project Orbit.xcodeproj -scheme Orbit \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ~/Library/Caches/Orbit/mobile-app/DerivedData build
xcodebuild -project Orbit.xcodeproj -scheme Orbit \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath ~/Library/Caches/Orbit/mobile-app/DerivedData test
```

Keep derived data outside the repository: the main checkout lives in iCloud Drive.

The app icon is drawn by `scripts/generate-icon.swift`
(`swift scripts/generate-icon.swift Orbit/Resources/Assets.xcassets/AppIcon.appiconset`).

## TestFlight

```sh
scripts/testflight.sh             # archive, export, upload
scripts/testflight.sh --no-upload # archive and export only
```

The script regenerates the project, numbers the build one above the highest build of the current version in
App Store Connect, archives Release, exports an App Store Connect IPA and uploads it with `altool`. It uses
the App Store Connect API key named by `ORBIT_ASC_KEY_ID`, `ORBIT_ASC_ISSUER_ID` and `ORBIT_ASC_KEY_PATH` (environment or the git-ignored `scripts/testflight.env`).

The export signs with the local "Apple Distribution" certificate and the "Orbit Mobile App Store"
provisioning profile. `scripts/app-store-profile.swift` fetches that profile through the App Store Connect
API, or creates it when it's missing or doesn't contain the certificate (the API key isn't allowed to use
cloud-managed distribution certificates, so Xcode's automatic export can't sign). The bundle id is
`com.ais.orbit-mobile` (team `MYXQKK3T2Z`); the App Store Connect app record must exist before the first
upload.

## Sync with the Mac

Sync is end-to-end encrypted and runs through a folder in iCloud Drive; there's no server. The `OrbitSync`
package (`OrbitSync/`) does the work; the app only talks to its `OrbitSyncing` protocol.

1. On the Mac, turn on sync in Orbit's Settings › Sync. Orbit creates the **Orbit Sync** folder
   (or **Ardia Sync**) in iCloud Drive and shows a 24-word recovery phrase and a Recovery Kit with a QR code.
2. On the phone, open Settings › Sync with Mac (or the Devices & Spaces button) and choose that folder.
3. Type or paste the recovery phrase, or scan the Recovery Kit's QR code.

After that the app syncs when it comes to the foreground, on pull-to-refresh and every 30 seconds while
open, and publishes its 30 most recent web tabs a moment after they change.

`Orbit/Sync/SyncProvider.swift` creates the sync client (`OrbitSyncClient`). `PreviewSync` is an in-app
stand-in with sample spaces and devices, used by SwiftUI previews and the unit tests. The name other devices
see for this one is set in Settings › Device Name.

## License

MIT, see [LICENSE](LICENSE). Orbit for Mac (the rest of this repository) is a fork of Ardia under the
Apache License 2.0.
