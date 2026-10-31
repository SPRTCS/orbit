# Contributing to Orbit

Orbit is an Arc-style browser for the Mac, built on [Ardia](https://github.com/mantrakp04/ardia) and Chrome's own
framework, plus an iPhone and iPad app in `apps/mobile`. Pull requests are welcome, and so are issues. This page is
what a review would otherwise teach you.

## What we take

Orbit aims for Arc's features, layout and feel, with Dia's polish where Ardia already has it. A change that brings an
Arc feature over, or makes one behave more like Arc, is almost always welcome. A change that restyles things to taste
usually isn't: open an issue first and we'll agree on the shape.

- **AI is fine when it's opt-in.** Off by default, and nothing leaves the Mac until the user turns it on and picks a
  provider. The MCP server follows the same rule.
- **No accounts of our own.** Sync goes through a folder the user picks, iCloud Drive by default.
- **No telemetry.** Orbit sends none.

Good places to start: [Issues](https://github.com/SPRTCS/orbit/issues), the 🟡 rows of
`docs/dia-feature-parity.md`, and the Orbit features in `docs/orbit.md` (pinned folders, Boosts, Air Traffic Control,
shared spaces, the glass sidebar, Devices, Capture, AI).

## How Orbit stays mergeable

Orbit follows Ardia's releases. Every upstream merge is easy only if Orbit touches as little of Ardia as it can:

- **Build features in Orbit's own files**, with the smallest hook that works in an upstream file.
- **List every hook** in `docs/orbit.md` › "Orbit layers and their hooks in upstream files", in the same PR.
- **Leave `engine/` alone.** Orbit ships upstream's prebuilt engine; any change there means building Chromium yourself.
  Engine fixes belong upstream.
- **Don't rename internals.** `Ardia.xcodeproj`, `ArdiaCore`, `@ardia/*` and `ARDIA_*` stay; `scripts/orbit/rebrand.mjs`
  handles what users see. If you add user-visible text to an upstream file, run `node scripts/orbit/rebrand.mjs --check`.

Pull requests go to the `orbit` branch. `main` mirrors upstream.

## Getting it running

You need an Apple Silicon Mac on macOS 14 or later, Xcode 26, CocoaPods, Node 22.13+ (pinned in `.nvmrc`) and pnpm 11.
You don't need to build Chromium.

```sh
pnpm install && packages/ardiacore/scripts/fetch-engine.sh && pnpm pods
pnpm dev
```

In another terminal:

```sh
cd apps/browser && xcodebuild -workspace macos/Ardia.xcworkspace -scheme Ardia-macOS \
  -derivedDataPath ~/Library/Caches/Orbit/build -destination 'platform=macOS,arch=arm64' \
  -configuration Debug -xcconfig macos/AdHoc.xcconfig
cd ../.. && scripts/agent/ac launch ~/Library/Caches/Orbit/build/Build/Products/Debug/Ardia.app --data /tmp/orbit-test
```

`ac launch` starts the build hidden, on its own throwaway data folder, so it never pops up over your work or touches
the Orbit you browse with. A Debug build refuses to start without a data folder. `ac eval` drives it through the dev
harness and `ac quit` ends it (`scripts/agent/ac --help`). A JS-only change needs no rebuild: Metro reloads it, though
relaunch the instance before you judge the result.

If your checkout lives in iCloud Drive, keep derived data outside it and pass an absolute `-derivedDataPath`:
`codesign` refuses bundles iCloud has tagged.

`docs/agent-brief.md` explains the architecture and the test tooling. It's written for coding agents and is just as
useful to people. Read `docs/store-api.md` before you touch app state.

The iPhone and iPad app is separate: see `apps/mobile/README.md`.

## What a good change looks like

- **It matches Arc, with numbers.** Compare against a capture of the same state with the same crop and give sizes,
  spacing, colours and, for motion, timing in frames. "Looks close" isn't a match.
- **Behaviour counts as much as looks.** Dismissing something never pauses playback or drags you to another tab.
  Clicking outside a popover closes it. Nothing reopens right after you close it. Actions follow the space you were
  just using. Hover never moves anything. Shortcuts work in every focus.
- **It lets Chrome do the work.** Orbit is real Chromium. Before writing our own version of something, check whether
  Chrome already does it and we're in the way.
- **It's simple.** Prefer the change that removes code. A bug that happens only sometimes usually means two pieces of
  code disagree about who owns the state.
- **It stays fast.** Performance is judged against the previous release (`docs/perf/README.md`). Every cache ships with
  a test that it doesn't go stale.

## Code style

- **No comments.** Not in source, scripts or config. Name things so the code says what it does, and put the why in the
  commit message. Tool directives, shebangs and license headers stay.
- Read the surrounding code first and match its naming and idioms.
- When JS starts needing native code that older builds lack, bump `NATIVE_API_VERSION` in
  `apps/browser/src/nativeApi.tsx` and `apiVersion` in `packages/shell/ios/AppModule.swift` together.

## Testing

Reproduce the bug first, ideally with a check that fails, then watch the same check pass. Tests run the real
production code; a copy of the logic inside a test proves nothing.

```sh
pnpm typecheck
pnpm test
```

The end-to-end checks need a built app and run hidden instances; `docs/testing.md` lists them. Never read a real
browser profile in a test, Orbit's included: build fixtures. Screenshots for a PR or the README use neutral public
pages, never anyone's feed or personal data.

## Reporting a bug

A screen recording is the fastest bug to fix. Include the version (Settings › General), your layout (address bar in
the sidebar or on top), how many spaces and windows you have, the steps, how often it happens, and the crash report
from `~/Library/Logs/DiagnosticReports` if it crashed.

## Pull requests

- One change per PR. Describe it the way a user would notice it, then how you checked it.
- For anything visible, attach a recording or before-and-after captures.
- Commit messages carry the why. A short subject saying what changed for the user, then a plain paragraph.
- Using a coding agent is fine. Point it at `AGENTS.md` and `docs/agent-brief.md` first, and read its diff yourself
  before you open the PR.
- Releases, version bumps and the appcast are the maintainers' job; leave them out of PRs.

## License

Orbit is Apache-2.0, and `apps/mobile` is MIT. By contributing you agree your work is released under the license of
the part you changed.
