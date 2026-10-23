# Orbit

Orbit is a fork of [Ardia](https://github.com/mantrakp04/ardia) (Apache-2.0) that aims for Arc's
features, layout and feel. This file covers what differs from upstream and how to keep the fork
mergeable.

## Branches and upstream

- `orbit` is Orbit's main branch. `upstream` points at mantrakp04/ardia.
- Track upstream **release tags**, not `main`: only releases publish a prebuilt engine
  (`packages/ardiacore/prebuilt-engines.tsv`), and a checkout whose `engine/` tree has no prebuilt
  needs a full Chromium build.
- Merging a new upstream release:
  1. `git fetch upstream --tags && git merge v<version>`
  2. For conflicts on branded lines, take upstream's side.
  3. `node scripts/orbit/rebrand.mjs` reapplies Orbit's branding; `--check` verifies it (CI-friendly).
  4. `packages/ardiacore/scripts/fetch-engine.sh`, then build.
- Keep `engine/` byte-identical to upstream until Orbit builds its own engine; any change there
  invalidates the prebuilt engine.

## Identity

| What | Value | Where |
| --- | --- | --- |
| App name | Orbit | `CFBundleName` / `CFBundleDisplayName` in `Ardia-macOS/Info.plist` (rebrand script) |
| Bundle ID | `com.aisconsulting.orbit` | `project.pbxproj` |
| Team | `MYXQKK3T2Z` (AIS Consulting UG) | `project.pbxproj` |
| Updates | GitHub releases of SPRTCS/orbit (`appcast.xml` asset) | `Info.plist` `SUFeedURL`, `Updater.swift` |
| Kill switches | `switches.json` in this repo (raw.githubusercontent.com) | `apps/browser/src/lib/killSwitches.ts` |
| Telemetry | off: `LOGS_URL` is empty, so nothing is sent and the app never asks | `apps/browser/src/telemetry/config.ts` |

The Xcode project, target and file names (`Ardia.xcodeproj`, `Ardia-macOS`, `Ardia.app` in builds) and all
internal identifiers (`ArdiaCore`, `@ardia/*`, `ARDIA_*` environment variables, native module names) stay as
upstream has them; renaming them would turn every upstream merge into a conflict.

### Still branded "Ardia" (needs our own engine build)

The prebuilt engine compiles in a few names: the keychain item "Ardia Safe Storage" (kept on purpose, it
holds the key for saved passwords and cookies), "Ardia" in Chrome-derived dialogs and `chrome://version`,
and the passkey/payment keychain groups for upstream's team, so Touch ID passkeys and saved cards don't
work in Orbit builds yet. A full rename means building the engine (`docs/engine-build.md`) with
`chromium-branding.patch` and `chromium-safe-storage-name.patch` adjusted.

## Spaces and shortcuts (Arc)

Profiles play the role of Arc's Spaces: user-visible strings for switching say "Space"; data settings
(logins, sharing) still say "Profile". Differences from upstream's defaults (`packages/shell/ios/Menus.swift`):

| Key | Orbit | Upstream |
| --- | --- | --- |
| ⌘D | Move to Pinned / Move out of Pinned (Arc's Pin/Unpin Tab) | Add to Bookmarks (now no key) |
| ⌥⌘→ / ⌥⌘← | Next / Previous Space | hidden Next / Previous Tab |
| ⌃⌘→ / ⌃⌘← | Next / Previous Tab (Arc's Cycle Tab) | none |
| ⌃⇧- | Close Split Pane | none |
| ⌃Space | Reveal Current Tab in the sidebar | none |

A "Spaces" menu (Next/Previous Space, New Space…, Edit Space…, each space on ⌃1–⌃9) replaces Window › Profiles,
and the sidebar footer shows each space's icon (a dot without one) with a "+" for a new space.

## Pinned folders (Arc)

The pinned section (pinned rows and pinned groups, not the Top Apps grid) can hold folders, nested to any
depth. Folders are an Orbit overlay: upstream's flat model (`Tab.pinned`/`pinnedAsRow`, `TabGroup`) stays the
source of truth for the pins themselves, and the overlay only adds hierarchy, order, names and collapsed state.

- **Model** (`store/pinnedFolders.ts`): one tree per space (profile), `{ root, folders: { id: { name, collapsed,
  children } } }`. Leaves are `t:<pinKey>` (a pinned row) and `g:<pinKey>` (a pinned group), so every window's
  mirrored copy of a pin (`pinKeyOf`, store/pinMirror.ts) maps to the same leaf; folders are `f:<id>`.
- **Self-healing**: rendering resolves the tree against the window's actual pinned rows/groups. A pin the tree
  doesn't know appears at root next to its upstream neighbour; a missing one isn't shown. A store subscription
  (`lib/pinnedFolders.ts`, only for spaces that have folders) records new pins, forgets removed ones, and follows
  upstream reorders among siblings (⌥⌘↑/↓, upstream drags while no folder exists). Deleting the last folder drops
  the tree, so a space without folders renders exactly upstream's markup.
- **Saved** in `pinned-folders.json` in the data dir. Not synced: the overlay isn't in upstream's sync format.
- **UI**: sidebar context menu and command bar "New Folder"; a pinned row's / pinned group's context menu
  "Move to Folder ›"; a folder's menu (Rename, New Folder Inside, Collapse, Move to Folder, Delete Folder: contents
  move up); click toggles, double-click renames; a collapsed folder keeps the path to the active tab visible. Drag
  a row, tile, list tab or group onto a folder header (middle half) to drop it in, between rows to place it; drag
  a folder header to move the folder (a line shows where).
- **Arc import** keeps Arc's pinned folders as pinned folders (with nesting and order) instead of bookmarks.

### Orbit layers and their hooks in upstream files

Re-apply these when a merge conflicts; everything else is in Orbit-owned files
(`store/pinnedFolders.ts`, `lib/pinnedFolders.ts`, `components/sidebar/PinnedFolders.tsx`,
`components/sidebar/pinnedFolderDrop.ts`, `components/sidebar/pinnedFolderMenus.ts`,
`components/import/arcFolders.ts`, and their tests).

| File (apps/browser/src unless noted) | Hook |
| --- | --- |
| `components/Sidebar.tsx` | import `PinnedFolders`; `<PinnedFolders …>` wraps the pinned rows / pinned groups / their two `Tail`s in `PageRows` (children deliberately not re-indented). Without folders it renders its children unchanged. |
| `components/sidebar/dnd.tsx` | import `pinnedTreeDrop`; `&& !pinnedTreeDrop(this, sources, drop, this.pointer)` in `DragController.end`'s commit condition: drops onto pinned rows / pinned groups go into the tree when the space has folders. |
| `components/sidebar/menus.ts` | import; `...pinnedFolderMenuItems(…)` + `runPinnedFolderMenu(…)` in `openTabMenu` and `openGroupMenu`; `...newPinnedFolderMenuItems(…)` + `runPinnedFolderMenu` in `openSidebarMenu`. |
| `lib/persist.ts` | import; `startPinnedFolders()` / `stopPinnedFolders()` next to the archive's. |
| `lib/commands.ts` | import; `case "newPinnedFolder"`. |
| `components/omnibox/actions.ts` | the "New Folder" command bar entry. |
| `packages/shell/src/index.tsx` | `"newPinnedFolder"` in `BrowserCommand`. |
| `components/import/apply.ts` | import; `space = arcPinnedFolders(profileId, space);` first line of `importArcSpace` (folders go to the overlay, all their links are imported as pinned rows). |
| `lib/devHarness.ts` | `ac.pinnedFolders` getter (dev only). |

## Building locally

```sh
pnpm install && packages/ardiacore/scripts/fetch-engine.sh && pnpm pods
pnpm dev                                    # Metro
cd apps/browser && xcodebuild -workspace macos/Ardia.xcworkspace -scheme Ardia-macOS \
  -derivedDataPath ~/Library/Caches/Orbit/build -destination 'platform=macOS,arch=arm64' \
  -configuration Debug -xcconfig macos/AdHoc.xcconfig
scripts/agent/ac launch ~/Library/Caches/Orbit/build/Build/Products/Debug/Ardia.app --data /tmp/orbit-test
```

`AdHoc.xcconfig` signs ad hoc, so no provisioning profile is needed. If the checkout lives in an
iCloud-synced folder (Desktop & Documents), keep derived data and `apps/browser/build-ardiacore` outside it
(a symlink to `~/Library/Caches/Orbit/build-ardiacore` works) and pass an absolute `-derivedDataPath`:
iCloud tags files with Finder info and `codesign` then refuses the bundle ("resource fork, Finder
information, or similar detritus not allowed").

Signed builds with entitlements need Xcode signed in to the team so it can create the provisioning
profile; releases also need a "Developer ID Application" certificate and notarization credentials.

## Releasing

Not set up yet: `scripts/release.sh` still checks upstream's bundle ID and team. Before the first Orbit
release: parametrize it, generate Orbit's own Sparkle EdDSA key (`SUPublicEDKey`), and publish
`appcast.xml` with the release assets.

## Credits

Orbit is built on Ardia by Mantra Patel (Apache-2.0); see `LICENSE` and `NOTICE`.
