#!/bin/bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/orbit/install-local.sh [--build-only] [--skip-build] [--no-open]

Builds Orbit from this checkout (Release, ad hoc signed) and installs it as
/Applications/Orbit.app without touching its data:

  1. builds into ~/Library/Caches/Orbit/build-release (outside iCloud)
  2. finds the running Orbit and the data folder it uses (ARDIA_DATA_DIR or the default
     ~/Library/Application Support/<bundle id>)
  3. quits Orbit and waits for it to exit (it never kills it)
  4. backs up every Orbit data folder and the old app to
     ~/Library/Application Support/Orbit Backups/<time>/
  5. if the running Orbit used another data folder and the default one is empty, copies that
     folder to the default location so the installed app finds the same pinned tabs
  6. replaces /Applications/Orbit.app and opens it

  --build-only   build and stop
  --skip-build   install the last build
  --no-open      don't open Orbit after installing
EOF
}

build=1
install=1
open_app=1
for arg in "$@"; do
  case "$arg" in
    --build-only) install=0 ;;
    --skip-build) build=0 ;;
    --no-open) open_app=0 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

root=$(cd "$(dirname "$0")/../.." && pwd)
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"
derived="$HOME/Library/Caches/Orbit/build-release"
built="$derived/Build/Products/Release/Ardia.app"
target="/Applications/Orbit.app"
bundle_id=$(sed -n 's/.*PRODUCT_BUNDLE_IDENTIFIER = \([^;]*\);/\1/p' "$root/apps/browser/macos/Ardia.xcodeproj/project.pbxproj" | head -1)
default_data="$HOME/Library/Application Support/$bundle_id"
stamp=$(date +%Y-%m-%d_%H-%M-%S)
backup="$HOME/Library/Application Support/Orbit Backups/$stamp"

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ -n "$bundle_id" ] || die "couldn't read the bundle id from the Xcode project"

xcode_build() {
  (cd "$root/apps/browser" && xcodebuild -workspace macos/Ardia.xcworkspace -scheme Ardia-macOS \
    -derivedDataPath "$derived" -destination 'platform=macOS,arch=arm64' -configuration Release \
    -xcconfig macos/AdHoc.xcconfig -quiet) >"$derived.log" 2>&1
}

if [ "$build" = 1 ]; then
  say "Building Orbit ($bundle_id)"
  mkdir -p "$(dirname "$derived")"
  find "$root" -name '* [2-9].*' -not -path '*/node_modules/*' -not -path '*/fixtures/*' -delete 2>/dev/null || true
  (cd "$root" && pnpm install --frozen-lockfile >/dev/null)
  "$root/packages/ardiacore/scripts/fetch-engine.sh"
  (cd "$root/apps/browser/macos" && pod install >/dev/null)
  if ! xcode_build; then
    if grep -q "detritus" "$derived.log"; then
      xattr -cr "$built" 2>/dev/null || true
      xcode_build || { tail -30 "$derived.log"; die "build failed, see $derived.log"; }
    else
      grep -E " error:" "$derived.log" | sort -u | head -20
      die "build failed, see $derived.log"
    fi
  fi
  say "Built $built"
fi

[ "$install" = 1 ] || exit 0
[ -d "$built" ] || die "no build at $built; run without --skip-build"

running_pids() {
  local pid
  for pid in $(pgrep -f '\.app/Contents/MacOS/(Ardia|Orbit)$' || true); do
    local exe
    exe=$(ps -o comm= -p "$pid" 2>/dev/null || true)
    local plist="${exe%/Contents/MacOS/*}/Contents/Info.plist"
    [ -f "$plist" ] || continue
    [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist" 2>/dev/null)" = "$bundle_id" ] && echo "$pid"
  done
}

data_dir_of() {
  ps -E -o command= -p "$1" 2>/dev/null | python3 -c '
import re, sys
match = re.search(r"\bARDIA_DATA_DIR=(.+?)(?= [A-Za-z_][A-Za-z0-9_]*=|$)", sys.stdin.read())
print(match.group(1).strip() if match else "")
'
}

say "Looking for a running Orbit"
pids=$(running_pids)
data_dirs=()
for pid in $pids; do
  dir=$(data_dir_of "$pid")
  data_dirs+=("${dir:-$default_data}")
  printf '    pid %s uses %s\n' "$pid" "${dir:-$default_data}"
done
[ -n "$pids" ] || printf '    not running\n'

if [ -n "$pids" ]; then
  say "Quitting Orbit"
  osascript -e "tell application id \"$bundle_id\" to quit" >/dev/null 2>&1 || true
  for _ in $(seq 1 60); do
    [ -z "$(running_pids)" ] && break
    sleep 0.5
  done
  [ -z "$(running_pids)" ] || die "Orbit is still running; quit it yourself and run again with --skip-build"
fi

say "Backing up to $backup"
mkdir -p "$backup"
candidates=("$default_data" "${data_dirs[@]+"${data_dirs[@]}"}")
seen=""
for dir in "${candidates[@]}"; do
  case "$seen" in *"|$dir|"*) continue ;; esac
  seen="$seen|$dir|"
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  ditto "$dir" "$backup/data-$name"
  printf '    %s\n' "$dir"
done
if [ -d "$target" ]; then
  ditto "$target" "$backup/Orbit.app"
  printf '    %s\n' "$target"
fi

for dir in "${data_dirs[@]+"${data_dirs[@]}"}"; do
  [ "$dir" != "$default_data" ] || continue
  if [ -z "$(ls -A "$default_data" 2>/dev/null)" ]; then
    say "Copying data from $dir to $default_data"
    mkdir -p "$default_data"
    ditto "$dir" "$default_data"
  else
    printf '\nnote: Orbit used %s, but %s already has data; left both as they are\n' "$dir" "$default_data"
  fi
  break
done

say "Installing $target"
rm -rf "$target.new"
ditto "$built" "$target.new"
xattr -cr "$target.new"
rm -rf "$target"
mv "$target.new" "$target"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$target/Contents/Info.plist" | sed 's/^/    version /'

if [ "$open_app" = 1 ]; then
  say "Opening Orbit"
  open "$target"
fi
say "Done. Backup: $backup"
