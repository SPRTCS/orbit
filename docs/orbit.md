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

### The prebuilt engine, branded for Orbit

Orbit ships upstream's prebuilt engine and edits it in place, never changing a length:
`scripts/orbit/brand-engine.sh <Chromium Framework.framework>`. `fetch-engine.sh` runs it on the framework it
returns, so every build, re-fetch and new upstream engine goes through it; staging (`stage-framework.sh`),
`embed.sh` and `release.sh` then sign every piece again as before (the prebuilt's own signature is already broken:
upstream strips it after signing). It's idempotent (`.orbit-branded` next to the framework records the script
and binary it last checked), and it fails the build when an engine doesn't hold exactly the occurrences it
expects: check a new upstream engine against it, then update its counts.

- **Keychain access groups** (Touch ID passkeys, Secure Payment Confirmation, device-bound session keys): the 8
  `U5L5T3NGVV.com.ardia.browser.<group>` literals become `MYXQKK3T2Z.com.ardia.browser.<group>`, and the
  entitlements list `$(AppIdentifierPrefix)com.ardia.browser.{webauthn,unexportable-keys,secure-payment-confirmation}`
  (`rebrand.mjs` rewrites upstream's `$(PRODUCT_BUNDLE_IDENTIFIER)` form). A keychain group only has to start
  with the team id; the rest is just a name. Chrome's Touch ID authenticator refuses to run unless the app's
  `keychain-access-groups` entitlement holds the group compiled in ("Touch ID authenticator unavailable because
  keychain-access-group entitlement is missing or incorrect. Expected value: …", on stderr), and
  `isUserVerifyingPlatformAuthenticatorAvailable()` answers false. `webauthn-uvk` (Google
  Password Manager's enclave) and `devicetrust` (Chrome Enterprise Device Trust) are renamed too and, as upstream
  does, left out of the entitlements: neither runs without Google services or cloud management. Only a build
  signed by the team with a provisioning profile (Xcode's automatic signing, or release.sh's Developer ID
  export) carries keychain groups; an ad hoc build has none, so it has no Touch ID authenticator.
- **Left alone:** `U5L5T3NGVV.com.google.common.folsom` and the bare team id `U5L5T3NGVV` (Google's Trusted Vault
  for Password Manager passkeys, which needs Google sync). The compiler folded the bare id's last two characters
  into an instruction, so a byte edit would leave a mixed id.
- **Product name:** Chrome's own strings say "Chromium"; ArdiaCore renames it as they load (`RenameProduct` in
  `engine/ardiacore/…/ac_strings.cc`: every dialog, menu and chrome:// page) to a UTF-16 literal stored right after
  "Chromium", which the script turns from "Ardia" into "Orbit". The engine's other `u"Ardia"`, the views widget's
  title (`ac_browser.mm`), is left alone: it's copied with its last character folded into an instruction, and the
  app sets the window's title itself (`ArdiaCoreChromeWindow.mm`). The locale `.pak` files and the framework's
  `Info.plist` hold no "Ardia", so nothing there changes.

### Still branded "Ardia"

- The keychain item "Ardia Safe Storage", account "Ardia": on purpose, it holds the key for saved passwords and
  cookies (`docs/engine-build.md` › `chromium-safe-storage-name.patch`). brand-engine.sh checks it's untouched.
- Identifiers, not display text: the framework's and helpers' bundle ids (`com.ardia.browser.framework`,
  `com.ardia.browser.helper…`), the keychain group names after the team id, "Chromium Helper" process names.
- The engine's messages for the `ardia` command ("Ardia has no data folder.", "Ardia Scripts …"): the command
  keeps its name.
- iCloud Keychain passkeys need Apple's `com.apple.developer.web-browser.public-key-credential` grant for
  `com.aisconsulting.orbit` (`Ardia-ICloudPasskeys.entitlements` is ready for it). Widevine stays blocked: it
  needs Google's VMP signing.
- `scripts/release.sh` still checks for upstream's team in the keychain groups (see Releasing).
- A full rename, including Safe Storage with a migration, means building the engine (`docs/engine-build.md`)
  with `chromium-branding.patch` and `chromium-safe-storage-name.patch` adjusted.

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
  children, emoji?, color? } } }`. `emoji` is one emoji (any sequence: skin tones, ZWJ, flags, keycaps; `folderEmoji`
  checks it by code point, as Hermes may lack `\p{}`), `color` one of the tab group colours (`GroupColor`,
  `GROUP_COLORS` in `components/sidebar/tokens.ts`). Both are sanitized when read (`appearanceOf`), so a bad value
  shows the default folder. Leaves are `t:<pinKey>` (a pinned row) and `g:<pinKey>` (a pinned group), so every window's
  mirrored copy of a pin (`pinKeyOf`, store/pinMirror.ts) maps to the same leaf; folders are `f:<id>`.
- **Self-healing**: rendering resolves the tree against the window's actual pinned rows/groups. A pin the tree
  doesn't know appears at root next to its upstream neighbour; a missing one isn't shown. A store subscription
  (`lib/pinnedFolders.ts`, only for spaces that have folders) records new pins, forgets removed ones, and follows
  upstream reorders among siblings (⌥⌘↑/↓, upstream drags while no folder exists). Deleting the last folder drops
  the tree, so a space without folders renders exactly upstream's markup.
- **Saved** in `pinned-folders.json` in the data dir.
- **Synced** with Pinned Tabs and Groups (Settings › Sync › What Syncs), by an Orbit adapter (`sync/pinnedFolders.ts`)
  in each profile's scope. One record per node, keyed `pinfolder:` + its overlay ref: `pinfolder:f:<folder id>` =
  `{ n (name), p (parent folder id or null), pos }`, and `pinfolder:t:<pin key>` / `pinfolder:g:<pin key>` =
  `{ p, pos }` for every row and pinned group in the tree, top level included (so a folder's place among the rows
  syncs). A folder's icon and colour are a record of their own, `pinfolder:a:<folder id>` = `{ e?, c? }`, published
  only while the folder has one (removing both tombstones it, as does deleting the folder), so a rename and a colour
  change made at once on two Macs both stay, and the folder record keeps its old `{ n, p, pos }` shape. Macs from
  before icons ignore `a:` records (their `nodeValue` rejects the ref) and never rewrite or delete them; an `a:`
  record whose folder hasn't arrived waits for it, and one this Mac didn't change is never rewritten while it means
  the same (fields a later version adds survive). `pos` is upstream's fractional position (`order.ts`), so a move changes only the moved node. Applying
  rebuilds the tree from the records: last writer wins per node, a deleted folder is a tombstone (the Mac that
  deleted it also publishes its contents' new places in the same batch), a folder cycle from two concurrent moves
  is cut at the lowest folder id on every Mac, a node whose folder is gone lands at the top level, and a node whose
  folder hasn't arrived yet waits there without republishing. Leaves name pins by `pinKeyOf`, the same key as
  upstream's `pin:t:`/`pin:g:`; a leaf whose pin record is a tombstone is dropped, one whose pin hasn't arrived keeps
  its place, and a pin with no record (from a Mac without folders) heals in next to its upstream neighbour and
  gets one. The user's own edits (create, rename, move, delete, a space import) are pending choices kept per node
  (`pinnedChoices` in `lib/pinnedFolders.ts`, dropped once their batch is on disk), like upstream's `pinChoices`: a
  choice is republished with a fresh timestamp even when its value ends where it started, and wins, also when made
  while files are being read and also for a node waiting for its folder. Only chosen nodes get new positions; their
  neighbours keep theirs, so moving a folder can't republish a neighbour over its remote rename.
  A node with no choice is never published over a record that has arrived but isn't applied yet (as `pth:`), so
  self-healing a pin that came in the same batch can't undo its placement, and a node waiting for its folder keeps
  its record. A leaf for a pin this Mac doesn't show and never synced isn't published. Collapsed is per Mac, as in Arc: it's a view of
  that Mac's sidebar, a click on one Mac shouldn't fold a folder someone is working in on another, and it would
  turn every toggle into a sync write. Older Macs and upstream Ardia keep the records unapplied and carry them
  in their snapshots (no adapter's prefix covers `pinfolder:`). Residuals, pinned in
  `sync/pinnedFolders.test.mjs`: a rename racing the deletion of the last folder brings the folder back empty and
  its old rows heal in after it; two Macs inserting at the same spot both publish the separation once. Choices
  live in memory: an edit made less than a cycle before a crash still publishes from the saved tree, but loses to a
  remote record that arrives with it, and a waiting node's top-level move is lost. A reorder the overlay follows on
  its own (an upstream ⌥⌘↑/↓ among rows) can reposition an unchosen folder and carry its name over a concurrent
  remote rename. Untested
  (it needs a log 45 days late, upstream's late-log residual): a move into a folder delivered after every Mac
  collected that folder's tombstone waits at the top level for good.
- **UI**: sidebar context menu and command bar "New Folder"; a pinned row's / pinned group's context menu
  "Move to Folder ›"; a folder's menu (Rename, Add/Change Icon…, Color › Default + the nine group colours, New Folder Inside, Collapse, Move to Folder, Delete Folder: contents
  move up); click toggles, double-click renames; a collapsed folder keeps the path to the active tab visible. Drag
  a row, tile, list tab or group onto a folder header (middle half) to drop it in, between rows to place it; drag
  a folder header to move the folder (a line shows where).
- **Icon and colour**: "Add Icon…" / "Change Icon…" opens upstream's icon picker (`IconPicker.tsx`, target kind
  `pinfolder`, id `pinfolder|<profile>|<folder>`) with only its emoji grid, search, an emoji typed into the search
  field as the first cell, and "Remove Icon". The emoji replaces the folder glyph; a colour tints the glyph, or,
  with an emoji, a rounded chip behind it (Dia shows a group's colour as a fill behind its header and keeps the icon
  as is). The name is never touched, so a name like "🟡 MLP" stays as typed. A click on the glyph still
  collapses the folder: Ardia's group header (Dia's) doesn't open the picker from its icon either.
- **Arc import** keeps Arc's pinned folders as pinned folders (with nesting and order) instead of bookmarks; they
  get no icon or colour (Arc folders have none).

### Orbit layers and their hooks in upstream files

Re-apply these when a merge conflicts; everything else is in Orbit-owned files
(`store/pinnedFolders.ts`, `lib/pinnedFolders.ts`, `components/sidebar/PinnedFolders.tsx`,
`components/sidebar/pinnedFolderDrop.ts`, `components/sidebar/pinnedFolderMenus.ts`,
`components/import/arcFolders.ts`, `sync/pinnedFolders.ts`, and their tests).

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
| `lib/devHarness.ts` | `ac.pinnedFolders` getter (dev only; also spreads `components/sidebar/pinnedFolderMenus`, so `openPinnedFolderMenu` can be driven with a stubbed `ArdiaShell.showMenu`). |
| `components/sidebar/state.ts` | Folder icons: `"pinfolder"` in `Target["kind"]`. |
| `components/sidebar/actions.ts` | Folder icons: import; `else if (target.kind === "pinfolder") setPinnedFolderPickerEmoji(target.id, icon);` in `setIcon`. |
| `components/sidebar/IconPicker.tsx` | Folder icons: imports; `folderEmoji`/`emojiOnly` and the `emojiOnly ? folderEmoji` branch of `current`; no emoji/symbols tab buttons and "Remove Icon" when `emojiOnly`; `typedEmoji(query)` first in the emoji items (an emoji typed into the search, for every target). |
| `sync/engine.ts` | Pinned folders sync: import; `pinnedFoldersAdapter(profileId, () => doc.scopes[…]?.records)` on its own line after the pinned adapters in `profileAdapters` (gated on `t.pinned`); `watchPinnedFolders(…)` after the store subscription in `startSync` (an edit schedules a cycle). |
| `lib/commands.ts` | Boosts: import; `if (runBoostCommand(command, requested)) return;` after the Little Ardia line (`zapElements`, `showBoosts`, `newBoost`). |
| `components/omnibox/actions.ts` | Boosts: the "Zap Elements…", "New Boost for This Site" and "Boosts" command bar entries. |
| `packages/shell/src/index.tsx` | Boosts: `"zapElements"`, `"showBoosts"`, `"newBoost"` in `BrowserCommand`; `"boosts"` in `OpenWindowOptions.kind`. |
| `components/settings/windows.ts` | Boosts: `BOOSTS_WINDOW_ID` and its `isUtilityWindowId` clause. |
| `components/settings/UtilityWindow.tsx` | Boosts: import; `id === BOOSTS_WINDOW_ID ? <BoostsWindow />`. |
| `components/site/SiteControls.tsx` | Boosts: import; `{origin ? <SiteBoosts …/> : null}` after `<SiteExtensions …/>`. |
| `components/Toolbar.tsx` | Boosts: import; `<BoostIndicator …/>` after `<ZoomIndicator …/>` in the URL field. |
| `components/extensions/state.ts` | Boosts: import; `refreshExtensions` filters `isBoostsExtension` out of the lists. |
| `main.tsx` | Boosts: import; `afterFirstWindow(startBoosts)`. |
| `lib/devHarness.ts` | Boosts: `ac.boosts` getter (dev only). |
| `packages/shell/expo-module.config.json` | Boosts: `"OrbitBoostsModule"` (`packages/shell/ios/OrbitBoosts.swift`; a new native file, so `pod install`). |
| `lib/commands.ts` | Spaces: imports; `if (runSpaceCommand(command, arg, requested)) return;` after the Boosts line; `takeSpaceFiles(await pickFiles())` in `openFiles`. |
| `lib/native.ts` | Spaces: import; `openExternalUrls(takeSpaceFiles(urls))` in `onOpenURLs` (Finder double-click, `open`). |
| `components/layout/fileDrop.tsx` | Spaces: import; `takeSpaceFiles(droppedUrls(e.items))` on drop. |
| `lib/persist.ts` | Spaces: import; `startOrbitSpaces()` / `stopOrbitSpaces()` next to the pinned folders'. |
| `components/profiles/ProfileDots.tsx` | Spaces: import; `...spaceMenuItems(id)` + `runSpaceMenu(…)` in the footer icon's context menu. |
| `components/omnibox/actions.ts` | Spaces: the Share/Copy/Import/Subscribe/Save Session/Sessions & Timeline command bar entries. |
| `packages/shell/src/index.tsx` | Spaces: `"shareSpace"`, `"importSpace"`, `"subscribeSpace"`, `"saveSession"`, `"showSessions"` in `BrowserCommand`; `"spaceImport"`, `"sessions"` in `OpenWindowOptions.kind`. |
| `components/settings/windows.ts` | Spaces: `SPACE_IMPORT_WINDOW_ID`, `SESSIONS_WINDOW_ID` and their `isUtilityWindowId` clauses. |
| `components/settings/UtilityWindow.tsx` | Spaces: imports; `SessionsWindow` / `SpaceImportWindow` branches. |
| `lib/devHarness.ts` | Spaces: `ac.spaces` getter (dev only). |
| `packages/shell/ios/Menus.swift` | Spaces: six items after "Edit Space…" in the Spaces menu; "Import Space…" after File › Open File…. |
| `packages/shell/expo-module.config.json` | Spaces: `"OrbitSpaceFilesModule"` (`packages/shell/ios/OrbitSpaceFiles.swift`, a new native file: `pod install`). |
| `Ardia-macOS/Info.plist` | Spaces: an "Orbit Space" `CFBundleDocumentTypes` entry (Owner) and `UTExportedTypeDeclarations` for `com.aisconsulting.orbit.space` (`.orbitspace`, conforms to `public.json`). |
| `main.tsx` | AI agents: import; `startAgentSpaces()` after `startCliControl()`. |
| `components/settings/panes/Advanced.tsx` | AI agents: import; `<AgentsSection />` after `<CommandLineSection />`. |
| `packages/ardiacore/src/WebView.tsx` | AI agents: `devToolsTarget()` in `WebViewHandle` and its implementation (next to `capturePicture`). |
| `packages/ardiacore/ios/CefModule.swift` | AI agents: the `devToolsTarget` view `AsyncFunction` after `capturePicture`. |
| `packages/ardiacore/ios/ArdiaCoreWebView.h` / `.mm` | AI agents: `-devToolsTarget:` (`Target.getTargetInfo` through the tab's `devToolsCall:`), before `-navigationEntries:`. Native: rebuild the app. |
| `apps/cli/ardia_cli/cli.py` | AI agents: `mcp_cli.add_parser(…)` after the scripts parser; `if args.command == "mcp": return mcp_cli.run(…)`. |
| `apps/cli/requirements.in`, `requirements.lock`, `pyproject.toml` | AI agents: `mcp==2.3.0` and its locked dependencies. |
| `packages/ardiacore/scripts/fetch-engine.sh` | Engine branding: `"$root/scripts/orbit/brand-engine.sh" "$dest/$name.framework" >&2 \|\| die …` before the final `echo`. |
| `Ardia-macOS/Ardia.entitlements`, `Ardia-ICloudPasskeys.entitlements` | Engine branding: keychain groups `$(AppIdentifierPrefix)com.ardia.browser.<group>` (`rebrand.mjs` writes them). |
| `components/littleArdia/actions.ts` | Air Traffic Control: import; `sourceApp` threaded through `openExternalUrls` / `openRoutedUrls` / `openUrlsFromApps`, which loops over `airTrafficFlights(…)`; the old body is `openFlight(urls, routed, little?)`, where `little` overrides the Little Orbit setting. |
| `lib/native.ts` | Air Traffic Control: `onOpenURLs((urls, sourceApp) => openExternalUrls(takeSpaceFiles(urls), sourceApp))`. |
| `lib/persist.ts` | Air Traffic Control: import; `linkProfile` is null while rules route links (`!airTrafficRoutesLinks()`), so the engine doesn't pre-open a launch link in a space a rule may send elsewhere; `airTrafficRoutesLinks()` is one of session.json's `sources` and `useAirTraffic.subscribe(…)` runs `check`, so a rule change alone rewrites session.json. |
| `packages/ardiacore/ios/ArdiaCoreHost.mm` | Air Traffic Control: import `OrbitAirTraffic.h`; `\|\| OrbitAirTrafficRoutesLinks(dir)` in `ParkLaunchLinks`'s and `TryEarlyLittleWindow`'s early returns (`OrbitAirTraffic.mm` reads `air-traffic.json`; a new native file: `pod install`, rebuild). |
| `lib/commands.ts` | Air Traffic Control: import; `if (runAirTrafficCommand(command, arg)) return;` after the Spaces line (`openSettings` with arg `airTraffic`). |
| `components/omnibox/actions.ts` | Air Traffic Control: the "Air Traffic Control…" command bar entry (`openSettings:airTraffic`). |
| `components/sidebar/menus.ts` | Air Traffic Control: import; `...airTrafficTabMenuItems(tab)` after "Move to Space" and `runAirTrafficTabMenu(choice, tab)` in `openTabMenu`. |
| `components/settings/windows.ts` | Air Traffic Control: `"airTraffic"` in `SettingsPane`. |
| `components/settings/SettingsWindow.tsx` | Air Traffic Control: import; the `airTraffic` entry in `PANES` (after Calendar) and its `case`. |
| `lib/devHarness.ts` | Air Traffic Control: `ac.airTraffic` getter (dev only). |
| `packages/shell/src/index.tsx` | Air Traffic Control: `sourceApp?` in the `onOpenURLs` event and listener. |
| `packages/shell/ios/ShellModule.swift` | Air Traffic Control: `OpenURLInbox` records `OrbitLinkSource.sender()` per delivery (held with `pending` until JS listens) and sends `OrbitLinkSource.payload(urls, from:)`. `OrbitLinkSource.swift` is a new native file: `pod install`, rebuild. |
| `App.tsx` | AI: import; `{!fullscreen && <ChatPanel />}` after `<ExtensionSidePanel />` (the chat sits right of the page card, like the extension side panel). |
| `components/settings/windows.ts` | AI: `"ai"` in `SettingsPane`. |
| `components/settings/SettingsWindow.tsx` | AI: import; the `ai` entry in `PANES` (after Air Traffic Control) and its `case`. |
| `lib/commands.ts` | AI: import; `if (runAiCommand(command, arg, requested)) return;` after the Air Traffic Control line (`toggleChat`, `askOrbit`, `summarizePage`; swallowed while AI is off). |
| `components/omnibox/actions.ts` | AI: import from `lib/ai/barActions` (kept free of heavy imports so `suggestStaleness.test.mjs` loads); `out.push(...aiBarActions(windowId))` at the end of `barActions` ("Ask Orbit…", "Summarize This Page", "Tidy Tabs", "Tidy Tabs: Regroup All", "Tidy Pinned Tab Titles"; empty while AI is off). |
| `lib/native.ts` | AI: import; `menuState` sends `shortcuts: aiShortcuts(…)` (⌘E to Toggle Chat and none to Use Selection for Find while AI is on, unless the user rebound either) and `optionalShown: aiShownMenuItems(…)`; `subscribeAiSettings(…)` re-syncs the menu. |
| `packages/shell/src/index.tsx` | AI: `"toggleChat"`, `"askOrbit"`, `"summarizePage"` in `BrowserCommand`; `optionalShown?` in `MenuState`. |
| `packages/shell/ios/Menus.swift` | AI: `MenuState.optionalShown`; View › "Toggle Chat" (after the Auto-Hide Tabs aliases, no default key); `optionalCommands` + `applyOptionalItems` hide it unless JS lists it (called in `refresh()` before `applyShortcuts`); `shortcutList` skips a hidden optional item. Native: rebuild. |
| `components/site/SelectionPopover.tsx` | AI: import; `<AskSelectionButton …/>` after `<SearchButton …/>` (renders nothing while AI is off). |
| `components/ContentCard.tsx` | AI: import; `else if (command === "ask") askAboutSelection(tabId, text);` in `onCommand` (the page context menu's "Ask Orbit about …"). |
| `packages/ardiacore/ios/ArdiaCoreWebView.h` / `.mm` | AI: `+setSelectionAskName:` (`gSelectionAskName`, nil = off); `contextMenuItemsForSelection` adds `{id: "ask", title: "Ask Orbit about “…”"}` after the search item when set; `contextMenuCommand` emits `command` `ask`. Native: rebuild. |
| `packages/ardiacore/ios/CefModule.swift` | AI: `AsyncFunction("setSelectionAskName")` after `setSearchEngineName`. JS calls it through `requireOptionalNativeModule`, guarded, so older builds just lack the menu item. |
| `main.tsx` | AI: import; `startAi()` after `afterFirstWindow(startBoosts)`. |
| `lib/devHarness.ts` | AI: `ac.ai` getter (dev only; also spreads `lib/ai/tidy`). |
| `packages/shell/src/index.tsx` | AI Tidy: `"tidyTabs"` (arg `all` = Regroup All), `"tidyTabTitles"` in `BrowserCommand`. |
| `components/sidebar/ClearDivider.tsx` | AI Tidy: import; `<TidyButton windowId={windowId} />` between the divider line and "↓ Clear" (renders nothing while AI is off, in private windows and Little Orbit). |
| `components/sidebar/GroupBlock.tsx` | AI Tidy: import; `<NameShimmer groupId={groupId}>` wraps the header's `FadeLabel` (an absolute-fill wrapper; pulses while the group is being named). |
| `components/sidebar/menus.ts` | AI Tidy: import; `...aiTabMenuItems(tab)` after "Reset Name" and `if (runAiTabMenu(choice, windowId, tab)) return;` after the Air Traffic Control line in `openTabMenu` ("Tidy Title" on pinned tabs). |
| `components/Downloads.tsx` | AI Tidy: import; `...aiDownloadMenuItems(d)` after "Show in Finder" and `if (runAiDownloadMenu(choice, d, windowId)) return;` after `showMenu` in `downloadMenu` ("Rename with AI"; the downloads page uses the same menu). |
| `packages/shell/expo-module.config.json` | AI Tidy: `"OrbitFilesModule"` (`packages/shell/ios/OrbitFiles.swift`, a new native file: `pod install`, rebuild). JS reaches it through `requireOptionalNativeModule`, so older builds just lack "Rename with AI". |
| `lib/commands.ts` | Capture: import; `if (runCaptureCommand(command, arg, requested)) return;` after the Spaces line. |
| `components/omnibox/actions.ts` | Capture: the "Capture…", "Capture Full Page" and "Capture Visible Area" command bar entries (after Print). |
| `packages/shell/src/index.tsx` | Capture: `"capture"` in `BrowserCommand` (arg `fullPage` / `visible`, none = an area). |
| `packages/shell/ios/Menus.swift` | Capture: File › "Capture…" ⇧⌘2 (+ a hidden ⌘@ alias: AppKit matches a US ⇧2 press as "@"), "Capture Full Page", "Capture Visible Area", after Save Page As…. Native: rebuild. |
| `components/ContentCard.tsx` | Capture: import; `<CapturePreview windowId={windowId} />` after `<SplitToast …/>`. |
| `components/site/SiteControls.tsx` | Capture: import; a "Capture…" `PopoverRow` after Zoom in the ⋯ section. |
| `lib/devHarness.ts` | Capture: `ac.capture` getter (dev only). |
| `packages/ardiacore/src/WebView.tsx` | Capture: `orbitCapture(method, params, file)` in `WebViewHandle` and its implementation (after `devToolsTarget`; resolves `{ error: "unavailable" }` on builds without it). |
| `packages/ardiacore/ios/CefModule.swift` | Capture: the `orbitCapture` view `AsyncFunction` after `devToolsTarget`. |
| `packages/ardiacore/ios/ArdiaCoreWebView.h` / `.mm` | Capture: `-orbitCapture:params:file:completion:` after `-devToolsTarget:`: only `Page.getLayoutMetrics` (returns `result`) and `Page.captureScreenshot` (decodes the PNG into `file`, returns `path`/`bytes`) through the tab's `devToolsCall:` (30 s timeout). Native: rebuild. |
| `packages/shell/expo-module.config.json` | Capture: `"OrbitCaptureModule"` (`packages/shell/ios/OrbitCapture.swift`, a new native file: `pod install`). |
| `store/settings.ts` | Glass sidebar: `sidebarStyle?: "glass" \| "classic"` in `Settings` (unset = Glass). |
| `lib/theme.ts` | Glass sidebar: import; first line of `profileTheme` after `color`: while Glass is on, `withGlassTokens(customTheme(profile?.theme ?? glassSpaceTheme(color), …), preset)`. |
| `components/Sidebar.tsx` | Glass sidebar: imports; `glass = useGlassSidebar()`, `footer = glass ? GLASS.footer : …`; `glass ? <GlassFooter …/> : footer ? …` for the footer; `glass ? <GlassHeaderTools …/> : <SidebarHeaderTools …/>`; `<SelectionGlide …/>` as `PageRows`' first child (an empty host view in Classic). |
| `components/sidebar/TabRow.tsx` | Glass sidebar: import; `gliding = useGlidingTo(windowId, tabId)`, `raised = active && !gliding` for the selected fill, border and shadow (the gliding pill stands in while it moves). |
| `components/Toolbar.tsx` | Glass sidebar: import; `glassField = useGlassField(!!sidebar)` in `UrlField`: capsule radius, no border, `urlPill` fill, no native glass fill, text at 13, the Site Controls sliders shown at rest. |
| `components/sidebar/AddressBar.tsx` | Glass sidebar: import; the same `glassField` overrides in `EmptyField`. |
| `components/ContentCard.tsx` | Glass sidebar: import; `cardRadius = useCardRadius()` for the pane's `borderRadius`; `<GlassCardEdge …/>` last in the pane. |
| `components/settings/panes/Appearance.tsx` | Glass sidebar: import; `<SidebarStylePicker />` after `<AddressBarPicker />`. |

## Shared spaces, sessions and the timeline (Arc)

User guide: `docs/spaces-sharing-and-sessions.md`. Orbit-owned files: `store/spaceSnapshot.ts` (versioned
document, serialize/parse), `store/spaceApply.ts` (apply a document's pins to a space), `store/spaceTimeline.ts`
(retention), `lib/spaces.ts`, `lib/spaceSessions.ts`, `lib/spaceSubscriptions.ts`, `components/spaces/*`,
`packages/shell/ios/OrbitSpaceFiles.swift`, and their tests.

- **Document** (`format: "orbit-space"`, `version: 1`): name, icon, colour, theme, Top Apps, the pinned section as
  a tree (rows, groups with their tabs, folders with children, in sidebar order) and optionally today tabs. Links
  are URL, page title, custom title and custom icon; only http(s) in shared files (local sessions also keep
  `file:`). Nothing else from the tab or profile. Parsing sanitizes every field, caps depth and node count, refuses
  newer versions with a message and upgrades older ones through `UPGRADES`.
- **Apply** builds pins the way upstream does: real `Tab`/`TabGroup` objects (unloaded, no navigation) in the window
  that shows the space, ordered with `pinnedFirst`/`orderSections`/`syncGroupOrder`, pin choices recorded for sync,
  then `mirrorPins` copies them to other windows. A space no window shows gets them through a stand-in window that
  `parkWindowPins` turns into `parkedPins` (the sync adapter's technique). Replace demotes open pinned tabs to today
  tabs and removes the rest; merge dedupes by page and merges groups by name. The folder tree is written through
  `replacePinnedTree` with the new pin keys.
- **Files in the data dir**: `space-sessions.json`, `space-timeline.json` (index) + `space-timeline-<space>.json`,
  `space-subscriptions.json`.

## Boosts (Arc)

Per-site customizations, applied by Chrome's own content scripts so they land before first paint, in every frame
and every tab, with no engine change.

- **Model** (`lib/boosts/model.ts`, store `store/boosts.ts`): a boost has a site (host, "include subdomains", an
  optional path prefix with `*` globs), a space (`profileId`, null for all spaces), on/off, CSS, JavaScript,
  zapped selectors, style options (font, colour tint and "dark page" through CSS filters, media counter-filtered),
  "run in private windows" (off by default) and `jsAllowed`. Saved in `boosts.json` in the data dir.
- **Compile and load** (`lib/boosts/compile.ts`, `lib/boosts/runtime.ts`): per engine profile, the live boosts
  become an MV3 extension with only `content_scripts` (no permissions, same shape the engine's Scripts policy
  accepts) that Orbit writes to `<data dir>/Boosts/<profile>/extension` through the `OrbitBoosts` native module
  (temp folder, then `renamex_np` swap; unchanged content isn't rewritten) and loads with `installExtension`,
  reloading it after a change. Each boost is one ISOLATED-world script at `document_start` that adds a
  `<style data-orbit-boost>` (re-attached if a page removes it) and, when allowed, one at `document_end` running the
  user's JavaScript with `chrome`/`browser` shadowed. Private windows: the extension is enabled in incognito only
  when some boost allows it, and every other boost's script returns on `chrome.extension.inIncognitoContext`. It's
  separate from the CLI's `Scripts/extension`, so `ardia scripts` and "Let the ardia command control Orbit" are
  unaffected, and it's hidden from the extensions lists.
- **Live edits**: open tabs get CSS changes and on/off at once (`liveStyleScript` through `webview.evaluate`
  rewrites or disables the `style[data-orbit-boost]` elements); JavaScript changes apply on reload.
- **Zap** (`lib/boosts/zap.ts`, `lib/boosts/pageScripts.ts`): an overlay in the page (closed shadow root) that
  highlights the element under the pointer, hides it on click and reports a selector: a stable id, then
  data-test/aria/role/name attributes, then the shortest unique tag + stable-class chain with `:nth-of-type` only
  where needed; hashed, generated and state classes are skipped. Each zap is saved into the site's boost at once;
  Undo (button or ⌘Z) and Done/Esc talk to the app through one pending `evaluate` per step.
- **UI**: command bar "Zap Elements…", "New Boost for This Site", "Boosts"; Site Controls › Boosts (per-boost
  toggles, Zap, Edit/New); a brush in the URL field when a boost is on for the page; the Boosts utility window
  (list for this site and other sites, editor with site, space, private windows, style, zapped elements, CSS and
  JavaScript, Export…, Copy as Text, Delete, Import from file/clipboard/pasted text).
- **Sharing**: `.orbitboost` files are JSON (`orbitBoost: 1`, name, site, css, js, zaps, style); spaces, private
  window permission and JS permission never travel. Import shows what the boost does and asks separately before
  its JavaScript may run; until then it's kept but not compiled.

## Air Traffic Control (Arc)

Rules that decide where a link from another app opens (Mail, Slack, Finder, `open URL`, Handoff: everything that
arrives through `onOpenURLs`). Links clicked inside Orbit, popups and `target=_blank` are untouched. Orbit-owned
files: `lib/airTraffic/{rules,store,flights,actions}.ts`, `lib/airTraffic/airTraffic.test.mjs`,
`components/settings/panes/AirTraffic.tsx`, `packages/shell/ios/OrbitLinkSource.swift`,
`packages/ardiacore/ios/OrbitAirTraffic.{h,mm}`, `lib/airTraffic/session.test.mjs`.

- **Rule**: a match (`domain`: the domain and every subdomain, `www.` and `*.` dropped, IDN as punycode;
  `contains`: case-insensitive substring of the URL; `glob`: `*` wildcards against the whole URL, with or without its
  scheme), an optional "from app" bundle ID, on/off, and a destination: a Space (profile), Little Orbit (in the current
  Space) or the current Space (a new tab in the window used last). Ordered; the first enabled match wins.
- **Fallback** for unmatched links: unset by default, which is upstream's behaviour (General › "Open links from other
  apps in"); or Current Space, Little Orbit or a Space.
- **Deleted Space**: a rule pointing at a Space that no longer exists shows "Space deleted: this rule is skipped" and
  matching falls through to the next rule (a deleted fallback Space means the default).
- **Source app**: `OrbitLinkSource` reads the sender PID of the `GURL`/`odoc` Apple event that is current while AppKit
  delivers `application(_:open:)` and maps it to a bundle ID (`NSRunningApplication`, else the outermost `.app` around
  the process's executable). Links that arrive before JS listens keep their source when they all share one. Links
  replayed from a cold launch (the bootstrap delegate in `ArdiaCoreHost.mm` stores them before the app delegate exists)
  and `open` from Terminal have no source, so "from app" rules don't match them.
- **Routing** (`lib/airTraffic/flights.ts`): each URL gets its destination at arrival (the current Space is resolved
  then, so an earlier link switching Spaces doesn't move later ones); consecutive URLs with the same destination form
  one flight; Little Orbit gets one window per link. Flights open through upstream's own paths (`openLittleArdia`,
  `openLinksInMainWindow`: a window showing the Space, else the most recent window paged to it, else a new window).
  A page the engine pre-opened at launch is adopted only when the destination shares its engine profile; while any
  rule or fallback is set, `session.json`'s `linkProfile` is null (a rule change rewrites session.json), and the
  engine itself skips pre-opening launch links and the early Little Orbit window when `air-traffic.json` has an
  enabled rule or a fallback, so a stale session can't load a link in the wrong Space's cookies.
- **Saved** in `air-traffic.json` in the data dir (`{ version: 1, rules, fallback }`, written on each change, read
  lazily and sanitized). Not synced.
- **UI**: Settings › Air Traffic Control (list with number, toggle, Edit…, a ⋯ menu to move or delete; Add Rule…; the
  fallback; "Test a URL" with an optional from-app field that names the matching rule); command bar "Air Traffic
  Control…"; a tab's context menu "Always Open <domain> in <Space>" (checked when the rule exists; choosing it again
  removes it; adding it replaces that domain's other plain rules and puts it first).

## AI (opt-in)

Chat beside the page, Ask on selected text, and Summarize This Page, through the user's own provider. **Off by
default**: with Settings › AI › "Use AI in Orbit" off there's no ⌘E chat (⌘E stays Find › Use Selection), no
View › Toggle Chat, no command bar entries, no Ask in the selection popover or context menu, and no request leaves
the Mac. Nothing reads the Keychain at launch either; keys are read the first time they're needed.

- **Providers**: Anthropic (Messages API, `anthropic-version: 2026-10-21`, models `claude-sonnet-5-5` for chat and
  `claude-haiku-5-5` for quick tasks, both editable; Claude 5-family models get `output_config.effort` medium/low,
  others none) or any OpenAI-compatible chat completions server (presets: Ollama `http://localhost:11434/v1`, LM
  Studio `http://localhost:1234/v1`, or a custom base URL; key optional; "Choose…" lists the server's `/models`).
  Plain-http endpoints only work on the local network (`NSAllowsLocalNetworking`); remote ones need https.
- **What is sent, and to whom**: only when the user sends a message or a quick prompt: the chat so far and, when
  "Include this page" is on (default from Settings), the active tab's title, URL, meta description and readable
  text (article/main/body `innerText` minus nav/footer/aside, at most 48,000 characters), a YouTube watch page's
  description and transcript instead (caption track from the player response, `fmt=json3`, else the open
  transcript panel; at most 40,000 characters), and a quoted selection (at most 4,000). It goes to
  api.anthropic.com or the configured base URL, nowhere else. A page already sent in the chat isn't sent again.
- **Storage**: settings in `ai-settings.json` in the data dir (no keys); API keys in the Keychain through the
  existing `ArdiaKeychain` module (service "Orbit Connected Accounts", accounts `ai.anthropic`, `ai.openai`; a
  scratch `ARDIA_DATA_DIR` keeps them in its own file, as for every connected account). Chats live per window in
  memory and go when the window closes or AI is turned off.
- **Shared client** for later features (`apps/browser/src/lib/ai/index.ts`): `aiEnabled()`, `useAiEnabled()`,
  `subscribeAiSettings(fn)`, `complete({ system, messages, model: "chat" | "quick", maxTokens, signal })`,
  `stream(…)` (async generator of text deltas), `streamText(req, onDelta)`, `listAiModels()`, `readActivePage(windowId)`,
  `aiAbortSignal()` (aborts the moment AI is turned off; take a fresh one per request) and `onAiDisabled(fn)`,
  and `AiError` (`code`: disabled, noKey, badKey, rateLimit, overloaded, offline, localServerDown, badModel,
  badRequest, refused, server, timeout, interrupted, aborted; `message` is user-presentable, with known API keys,
  bearer tokens and `sk-…` strings redacted; servers' own error text is shown only for Anthropic's
  `invalid_request_error`, every other failure is generic with its status). Every request goes through one guarded
  transport (`client.ts`) that re-checks "Use AI" right before sending, after the Keychain read, and aborts with
  `disabled` when AI is turned off mid-request. A stream that ends without `message_stop` / `[DONE]` /
  `finish_reason` is `interrupted`. Turning AI on or off is saved at once; other settings within 400 ms and on quit. Streaming goes through React
  Native's `XMLHttpRequest` with incremental `responseText` (`onprogress`; RN's `fetch` has no streaming body), an
  idle timeout of 120 s, and `AbortSignal` for Stop.
- **UI**: the Chat panel (`components/ai/ChatPanel.tsx`, ⌘E / View › Toggle Chat / "Ask Orbit…"): right of the page
  card like the extension side panel (same 200 ms reveal, drag to resize 320–640 pt, double-click resets), streamed
  Markdown (`lib/ai/markdown.ts`, `components/ai/Markdown.tsx`: headings, lists, tables, quotes, code blocks with
  Copy, links open in a new tab), Stop, Retry, New Chat, Copy, the "Include …" page chip, quick prompts
  (Summarize, Explain simply, Key points). Enter sends, Shift-Enter is a new line, Esc stops, clears the quote or
  closes. Ask on a selection (popover button or context menu "Ask Orbit about “…”") opens the panel with the
  selection quoted.
- **Tidy (Arc Max's quick features)**, all on the quick model, all hidden while AI is off, none in private windows:
  - **Tidy Tabs**: "Tidy" (wand) left of "↓ Clear" on the divider above the tab list, or the command bar's "Tidy
    Tabs". It sends the unpinned, ungrouped, unsplit tabs' titles and hostnames (at most 120; never URLs or page
    text), asks for JSON groups (`{"groups":[{"name","emoji","tabs":[1,4]}]}`), drops unknown/duplicate ids, groups
    under 2 tabs and anything past 8 groups, and makes regular (unpinned) groups with the name and the emoji as icon
    (`withGroup`, one store update). Right-click "Tidy" or the command bar's "Tidy Tabs: Regroup All" also sends
    the tabs of unpinned groups; only tabs that were sent and placed in a new group leave their old group (a group
    left empty goes), so groups past the 120-tab cap and split tabs keep their tabs and names. The "Tidied N Tabs
    into M Groups" toast's Undo restores the exact order and every changed group (same ids). No ⌘Z: upstream has no undo stack for tab edits (Edit › Undo
    goes to the first responder).
  - **Group names** (Settings › AI › "Name new tab groups with AI", default on): a group that has no name (or still
    has the name the AI gave it) gets a short name and an emoji from its tabs' titles and hosts, 1.5 s after its
    membership settles, while its label pulses. Only groups that appear or change membership after launch (or after
    the setting turns on); a name you give always wins and is never replaced; an icon you chose stays; on any error
    the heuristic name (`store/groupNames.ts`) stays. Pinned group copies in other windows share one request (by
    `pinKey`) and follow through the pin mirror. `lib/ai/groupNaming.ts`.
  - **Tidy Titles**: "Tidy Title" in a pinned tab's menu, "Tidy Titles" in a pinned folder's menu (every pinned
    tab in it and its subfolders), "Tidy Pinned Tab Titles" in the command bar. Sends titles and hosts, sets
    `customTitle` (Reset Name or Rename… take it back); the toast's Undo restores the previous custom titles.
  - **Tidy Downloads**: "Rename with AI" in a finished download's menu (popover and `ardia://downloads`), and
    Settings › AI › "Rename downloads with AI" (default off) for each download that finishes. Sends the file name,
    the download's host and, when known, the title of the tab that was in front when it started; never the file.
    The name is sanitized (no `/ \ : * ? " < > |`, control or bidi characters, leading dots; ≤ 80 characters) and
    keeps the original extension (`.tar.gz` and the like too). The file's identity (device:inode,
    `OrbitFiles.fileIdentity`) is taken before the request; `OrbitFiles.renameFile(path, name, identity)` refuses
    when the file at the path is no longer that file (moved and replaced while the model answered), renames in the
    same folder only, never over an existing file (" 2", " 3"… instead), only regular files (not symlinks); never a
    download still in progress, paused or private. The toast's Undo renames it back under the same identity check. The store's download keeps the new path (and
    takes it back if the engine re-reports the old one).
  - Turning AI off stops every Tidy job: each job holds a shared `AbortSignal` (`lib/ai/tidyJobs.ts`) that is aborted
    when AI goes off, so a request not yet sent isn't, one in flight is cancelled, and enablement is checked again
    after every await before any tab, group, title or file changes (`lib/ai/tidyJobs.test.mjs` drives each feature
    through an injected transport).
  - Prompts and parsing are pure (`lib/ai/tidyPrompts.ts`, tested in `lib/ai/tidy.test.mjs`: fences, prose and
    `<think>` blocks around the JSON, invalid output, missing/duplicate ids, overlong names, unsafe filename
    characters, extension preservation).
- **Files**: `lib/ai/{index,settings,client,run,transport,providers,errors,prompt,pageScript,markdown,menu,chat,commands,barActions,start}.ts`,
  `lib/ai/{tidy,tidyPrompts,tidyScope,tidyJobs,tidyTabs,groupNaming,tidyTitles,tidyDownloads}.ts`,
  `lib/ai/ai.test.mjs`, `lib/ai/tidy.test.mjs`, `lib/ai/tidyJobs.test.mjs`, `components/ai/{ChatPanel,Markdown,AskSelectionButton,TidyButton,NameShimmer}.tsx`,
  `components/settings/panes/AI.tsx`, `packages/shell/ios/OrbitFiles.swift`. `components/sidebar/pinnedFolderMenus.ts`
  (Orbit's) has the folder's "Tidy Titles" item.

## Capture (Arc)

Screenshots of the page through the engine (the tab's DevTools `Page.captureScreenshot`), never the screen: it works
with the screen locked, never picks up other apps, and is at device scale (a 200 × 150 pt area is 400 × 300 px on a
Retina display, 600 × 450 at 150 % zoom).

- **Start**: ⇧⌘2 (Arc's; free in Orbit, Chrome and Dia) or File › Capture…; the command bar's "Capture…",
  "Capture Full Page", "Capture Visible Area"; Site Controls › ⋯ › Capture…. Not in the page's context menu: that's
  Chrome's own menu, and the engine only lets the app add items for a selection.
- **Area** (`lib/capture/pageScript.ts`): an overlay in the page (closed shadow root) dims it with a crosshair; hovering
  outlines the element under the pointer, a click captures that element (whole, also beyond the viewport), a drag
  captures the area with a live size readout in points; the bar offers Visible Area, Full Page and Cancel. Esc cancels
  (during a drag it drops only the drag), and so does running the command again, switching tabs or navigating. The
  overlay is removed and two frames pass before the capture, so it never shows in the image. Pages the overlay can't
  run on (chrome://, the New Tab page) capture the visible area instead.
- **Clip math** (`lib/capture/model.ts`, measured on Chromium 155): `clip` is in document coordinates in zoomed
  DIPs (CSS px × page zoom), and the image is `clip × scale × device scale`; so an area is `(rect + scroll) × zoom` at
  `scale: 1`. Zoom and device scale come from `Page.getLayoutMetrics` (`cssVisualViewport.zoom`, and
  `visualViewport.clientWidth / (cssVisualViewport.clientWidth × zoom)`). Full page is `cssContentSize × zoom` with
  `captureBeyondViewport`, scaled down to fit 16384 px, and cut below half scale ("cut to fit" in the card).
- **After**: the PNG is written to `$TMPDIR/Orbit Captures/Orbit Capture <date> at <time>.png` (pruned after a day)
  and copied to the clipboard at once (PNG, plus TIFF up to 12 MP). A card at the content area's bottom right shows a
  thumbnail and the size: Copy, Save (to ~/Downloads under the same name, `(2)` for copies, listed in Downloads), then
  Show in Finder, Close; drag the thumbnail out to drop the file anywhere, click it to open the image in a tab. It
  closes after 8 s unless hovered. A split view captures the focused pane.
- **Files**: `lib/capture/{capture,model,pageScript,native}.ts`, `lib/capture/capture.test.mjs`,
  `components/capture/CapturePreview.tsx`, `packages/shell/ios/OrbitCapture.swift` (folder, image info and
  thumbnail, clipboard, save).

## AI agents (MCP)

`ardia mcp` serves Orbit to AI agents over MCP; user and design docs: `docs/mcp.md`. Orbit-owned files:
`apps/cli/ardia_cli/{mcp_cli,mcp_server,mcp_install,agent_browser,agent_policy,agent_scripts,agent_data}.py`,
`apps/cli/tests/test_mcp.py`, `apps/browser/src/lib/agentSpaces.ts` (+ test), and
`components/settings/panes/Agents.tsx`. The app publishes the allowed spaces' browser contexts in
`<data dir>/agent-spaces.json`; the server filters every target by it. Upstream's CLI still defaults to
`com.ardia.browser` for the data dir; `ardia mcp` looks for Orbit's (`com.aisconsulting.orbit`) first.

## Glass sidebar (Orbit)

Settings › Appearance › Sidebar Style: **Glass** (default) or **Classic** (upstream's look, pixel-identical: with
Classic every hook takes upstream's path). Glass is modelled on the Radian browser. Orbit-owned files:
`lib/glassTheme.ts` (setting, gradient themes, tokens, metrics) and `components/glassSidebar/*`.

- **Window**: a space without a custom theme gets a synthesized one (`glassSpaceTheme`): peach top-left, a lighter
  peach bottom-right and a cream wash toward the bottom, translucency 0.25, rotated in OKLab hue to the space's
  colour (Plum, the default, is the peach). A dark counterpart of each lives in the theme's `dark` look. A space's own
  theme (Edit Space › Theme) is used as is. The page card gets a 14 pt radius and a hairline edge.
- **Tokens** (`withGlassTokens`): selected row `rgba(255,255,255,0.24)` with a white top / 10% black bottom hairline
  and a 6 pt shadow; URL field `rgba(0,0,0,0.055)`. The space's accent and power-up colours stay the preset's.
- **Header**: 32 pt glass circles on 40 pt hit areas: sidebar toggle at x 99, reload at the right edge (6.5 pt), back
  as a circle left of it, back + forward as one capsule while forward is possible. Same behaviours as upstream's
  buttons (⌘/⇧ clicks, long press or right click for history).
- **URL field**: a 34 pt capsule, the Site Controls sliders always shown.
- **Folders** (`PinnedFolders.tsx`): blue filled folder, semibold name, chevron right after it.
- **Footer** (42 pt): the space avatar (`ProfileBadge`: icon, emoji or initial on the space colour) in a glass ring,
  a dots capsule (38 × 19 pt, 5 pt dots, click to switch, right click for the space menu, ⌃1–9 unchanged) and a
  Downloads circle (address bar in the sidebar only). The avatar opens a menu: New Window, New Private Window, the
  spaces with a check, Add Space, History, What's New, Settings.
- **Motion** (measured at 30 fps from the reference video): the menu grows from the avatar (bottom-left anchor),
  scale 0.2 → 1 on a critically damped spring ω = 20/s (reference widths 31/58/73/82/94/96/100 % on frames
  1–7) and fades in over 70 ms; it closes in 140 ms. The selection pill glides between rows on a critically damped
  spring ω = 28/s (reference 34/61/77/88/94/97/99 % of the way on frames 1–7): `SelectionGlide` draws it behind the
  rows for top-level tabs in the list when the list itself didn't change; any other change switches instantly.
  Buttons bloom to 1.18× while pressed.
- **Touch**: taps on a touchscreen Mac reach React Native as mouse events, so every Pressable works; the macOS 27 SDK
  also has `NSScreen.touchCapabilities`, direct-touch `NSTouch`/`NSEventTypeDirectTouch` events, gesture recognizers
  that default to direct touches and `NSScrollView.touchScrollingEnabled` (on by default, so the sidebar list
  scrolls by touch). Hover-only controls (a row's close button, the URL field's bookmark) don't appear for touch.
- **Dev handles** (`__DEV__` only): `globalThis.orbitAvatarMenu` (`setState({[windowId]: true})`, `run(item, windowId)`)
  and `globalThis.orbitGlide`.

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
