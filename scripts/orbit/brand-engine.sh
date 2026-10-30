#!/bin/bash
set -euo pipefail
usage="usage: brand-engine.sh <Chromium Framework.framework>

Brands Ardia's prebuilt engine for Orbit, in place: the keychain access groups compiled for upstream's team
(U5L5T3NGVV.com.ardia.browser.*) become Orbit's (MYXQKK3T2Z.com.ardia.browser.*), and the product name Chrome's
strings are renamed to (\"Chromium\" -> \"Ardia\") becomes \"Orbit\". Every edit keeps its length, and the script
fails when the engine doesn't hold exactly the expected occurrences. \"Ardia Safe Storage\" is never touched.
Idempotent: a branded framework is left alone. fetch-engine.sh runs it on every prebuilt it returns; the prebuilt's
signature is already broken (upstream strips it after signing), and stage-framework.sh, embed.sh and release.sh
sign every piece again. See docs/orbit.md."

die() { echo "error: brand-engine.sh: $*" >&2; exit 1; }
case "${1:-}" in
  -h | --help) echo "$usage"; exit 0 ;;
  "") echo "$usage" >&2; exit 64 ;;
esac

name="Chromium Framework"
fw=$(cd "$1" && pwd) || die "no framework at $1"
binary="$fw/Versions/Current/$name"
[[ -f "$binary" ]] || die "$fw holds no $name"
[[ "$fw" != "$HOME/chromium-build/"* ]] || die "refusing to edit the Chromium build tree ($fw)"
store=$(dirname "$fw")
marker="$store/.orbit-branded"

if [[ -z "${ORBIT_BRAND_ENGINE_LOCKED:-}" ]]; then
  ORBIT_BRAND_ENGINE_LOCKED=1 exec lockf -k -t 600 "$store/.orbit-brand.lock" "$0" "$fw"
fi

want="$(shasum -a 256 "$0" | cut -c1-16) $(stat -f '%z %m' "$binary")"
if [[ -f "$marker" && "$(cat "$marker")" == "$want" ]]; then
  exit 0
fi

changed=$(python3 -I - "$binary" <<'PY'
import os, sys

path = sys.argv[1]
utf16 = lambda text: text.encode("utf-16-le")
EDITS = [
    ("keychain access groups", b"U5L5T3NGVV.com.ardia.browser.", b"MYXQKK3T2Z.com.ardia.browser.", 8),
    ("product name in Chrome's strings", utf16("Chromium\0Ardia\0"), utf16("Chromium\0Orbit\0"), 1),
]
KEPT = [b"Ardia Safe Storage\0Ardia\0"]

data = open(path, "rb").read()
kept = [data.count(bytes_) for bytes_ in KEPT]
if 0 in kept:
    sys.exit(f"{path} has no Safe Storage item name; this isn't the engine brand-engine.sh knows")
branded = data
for what, old, new, expected in EDITS:
    assert len(old) == len(new)
    found, done = branded.count(old), branded.count(new)
    if found == 0 and done == expected:
        continue
    if found != expected or done != 0:
        sys.exit(f"{what}: expected {expected} of {old!r}, found {found} (and {done} already branded): "
                 "a new engine needs scripts/orbit/brand-engine.sh checked against it")
    branded = branded.replace(old, new)
if [branded.count(bytes_) for bytes_ in KEPT] != kept:
    sys.exit("the Safe Storage item name changed; nothing was written")
if branded == data:
    print(0)
    sys.exit(0)
tmp = path + ".orbit-brand"
with open(tmp, "wb") as out:
    out.write(branded)
os.chmod(tmp, os.stat(path).st_mode & 0o7777)
os.replace(tmp, path)
print(1)
PY
) || die "branding $binary failed"

[[ "$changed" == 0 ]] || echo "branded the engine for Orbit: $fw" >&2
echo "$(shasum -a 256 "$0" | cut -c1-16) $(stat -f '%z %m' "$binary")" > "$marker"
