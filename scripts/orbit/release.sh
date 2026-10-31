#!/usr/bin/env bash
set -euo pipefail

usage="Usage: scripts/orbit/release.sh <version> [--new-feed] [scripts/release.sh options]

Builds, signs, notarizes and packages an Orbit release into dist/<version>/ through
scripts/release.sh (which rebrand.mjs points at SPRTCS/orbit, Orbit's team and Sparkle key):

  - uses the prebuilt engine from fetch-engine.sh, so no Chromium tree is needed
  - keeps derived data in ~/Library/Caches/Orbit/release-build
  - refuses a checkout in iCloud Drive, unbranded files or a build number under 100
  - puts Podfile.lock back when pod install only rewrote ArdiaCore's checksum (it holds the checkout's path)

  --new-feed   start a new appcast; only while SPRTCS/orbit has none published

Publishing and the rest of the flow: docs/orbit.md › Releasing."

case "${1:-}" in -h | --help | "") echo "$usage"; [ -n "${1:-}" ]; exit ;; esac
version="$1"
shift
new_feed=0
passthrough=()
for arg in "$@"; do
  case "$arg" in
    --new-feed) new_feed=1 ;;
    *) passthrough+=("$arg") ;;
  esac
done

root="$(cd "$(dirname "$0")/../.." && pwd -P)"
repo="SPRTCS/orbit"
feed="https://github.com/$repo/releases/latest/download/appcast.xml"
first_build=100
die() { echo "error: $*" >&2; exit 1; }

case "$root" in
  "$HOME/Library/Mobile Documents/"* | "$HOME/Documents/"* | "$HOME/Desktop/"*)
    die "$root syncs with iCloud Drive, which tags the bundle with Finder info codesign refuses: release from a clone outside it (~/Developer/orbit-src)" ;;
esac

node "$root/scripts/orbit/rebrand.mjs" --check >/dev/null \
  || die "the checkout isn't fully branded: run node scripts/orbit/rebrand.mjs and commit"

pbx="$root/apps/browser/macos/Ardia.xcodeproj/project.pbxproj"
build="$(sed -n 's/.*CURRENT_PROJECT_VERSION = \(.*\);/\1/p' "$pbx" | sort -u)"
[[ "$build" =~ ^[0-9]+$ ]] || die "CURRENT_PROJECT_VERSION isn't one number ($build)"
[ "$build" -ge "$first_build" ] \
  || die "CURRENT_PROJECT_VERSION is $build: Orbit's builds start at $first_build (an upstream merge took upstream's number; restore Orbit's)"

lock="$root/apps/browser/macos/Podfile.lock"
manifest="$root/apps/browser/macos/Pods/Manifest.lock"
lock_changes="$(git -C "$root" diff -U0 -- "$lock" | grep '^[-+] ' || true)"
if [ -n "$lock_changes" ] && ! grep -qv '^[-+]  ArdiaCore: [0-9a-f]*$' <<<"$lock_changes"; then
  git -C "$root" show HEAD:apps/browser/macos/Podfile.lock >"$lock"
  [ -f "$manifest" ] && cp "$lock" "$manifest"
  echo "Podfile.lock: put back the committed ArdiaCore checksum"
fi

if [ "$new_feed" = 1 ]; then
  code="$(curl -sL -o /dev/null -w '%{http_code}' "$feed")"
  [ "$code" = 404 ] || die "--new-feed, but $feed answers $code: a feed is published, so build on it"
  export APPCAST_BASE=none
fi

ARDIACORE_FRAMEWORK="$("$root/packages/ardiacore/scripts/fetch-engine.sh")" || die "no prebuilt engine"
export ARDIACORE_FRAMEWORK
export RELEASE_BUILD_DIR="${RELEASE_BUILD_DIR:-$HOME/Library/Caches/Orbit/release-build}"
mkdir -p "$RELEASE_BUILD_DIR"

exec "$root/scripts/release.sh" "$version" ${passthrough[@]+"${passthrough[@]}"}
