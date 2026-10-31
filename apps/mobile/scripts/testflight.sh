#!/bin/zsh
# Usage: scripts/testflight.sh [--no-upload]
#
# Builds Orbit for iPhone and iPad and sends it to TestFlight:
# regenerates Orbit.xcodeproj with XcodeGen, numbers the build one above the highest build of this version in App Store Connect (1, 2, 3, …),
# archives Release for generic/platform=iOS, exports an App Store Connect IPA and uploads it with altool.
# The export signs with the local "Apple Distribution" certificate and the "Orbit Mobile App Store" profile,
# which scripts/app-store-profile.swift fetches (or creates) through the App Store Connect API.
# Build products go to ~/Library/Caches/Orbit/mobile-app (the checkout lives in iCloud).
#
# Needs an App Store Connect API key: set ORBIT_ASC_KEY_ID, ORBIT_ASC_ISSUER_ID and ORBIT_ASC_KEY_PATH (the .p8),
# or put them in scripts/testflight.env (git-ignored), which the script sources.
#
#   --no-upload   stop after the export; the IPA is left in ~/Library/Caches/Orbit/mobile-app/export
#   -h, --help    print this help
set -euo pipefail

upload=1
for argument in "$@"; do
  case "$argument" in
    --no-upload) upload=0 ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) print -u2 "Unknown option: $argument (see --help)"; exit 2 ;;
  esac
done

mobile_dir="${0:A:h:h}"
[[ -f "$mobile_dir/scripts/testflight.env" ]] && source "$mobile_dir/scripts/testflight.env"
key_id="${ORBIT_ASC_KEY_ID:?set ORBIT_ASC_KEY_ID (see --help)}"
issuer_id="${ORBIT_ASC_ISSUER_ID:?set ORBIT_ASC_ISSUER_ID (see --help)}"
key_path="${ORBIT_ASC_KEY_PATH:?set ORBIT_ASC_KEY_PATH (see --help)}"
keys_dir="${key_path:h}"
work_dir="$HOME/Library/Caches/Orbit/mobile-app"
archive_path="$work_dir/archive/Orbit.xcarchive"
export_path="$work_dir/export"
bundle_id="com.ais.orbit-mobile"
profile_name="Orbit Mobile App Store"

[[ -f "$key_path" ]] || { print -u2 "Missing App Store Connect key: $key_path"; exit 1; }
mkdir -p "$work_dir"
cd "$mobile_dir"
find Orbit OrbitTests scripts -name '* 2.*' -print -delete

/opt/homebrew/bin/xcodegen generate --quiet
version="$(sed -n 's/^ *MARKETING_VERSION: *//p' project.yml | head -1)"
last_used_file="$work_dir/last-build-$version"
remote_next="$(swift scripts/next-build-number.swift "$key_path" "$key_id" "$issuer_id" "$bundle_id" "$version")"
local_next=$(( $(cat "$last_used_file" 2>/dev/null || print 0) + 1 ))
build_number=$(( remote_next > local_next ? remote_next : local_next ))
rm -rf "$archive_path" "$export_path"

print "Archiving Orbit $version build $build_number"
xcodebuild -project Orbit.xcodeproj -scheme Orbit -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$work_dir/DerivedData-Release" \
  -archivePath "$archive_path" \
  CURRENT_PROJECT_VERSION="$build_number" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$key_path" -authenticationKeyID "$key_id" -authenticationKeyIssuerID "$issuer_id" \
  archive

print "Installing the App Store provisioning profile"
certificate_serial="$(security find-certificate -c "Apple Distribution: AIS Consulting" -p | openssl x509 -noout -serial | cut -d= -f2)"
[[ -n "$certificate_serial" ]] || { print -u2 "No Apple Distribution certificate for AIS Consulting in the keychain"; exit 1; }
xcrun swift "$mobile_dir/scripts/app-store-profile.swift" "$key_path" "$key_id" "$issuer_id" "$bundle_id" "$profile_name" "$certificate_serial"

print "Exporting IPA"
xcodebuild -exportArchive \
  -archivePath "$archive_path" \
  -exportPath "$export_path" \
  -exportOptionsPlist "$mobile_dir/scripts/ExportOptions.plist" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$key_path" -authenticationKeyID "$key_id" -authenticationKeyIssuerID "$issuer_id"

ipa="$export_path/Orbit.ipa"
[[ -f "$ipa" ]] || { print -u2 "Export produced no IPA in $export_path"; exit 1; }

if (( upload == 0 )); then
  print "Exported $ipa (build $build_number); upload skipped."
  exit 0
fi

print "Uploading build $build_number to App Store Connect"
API_PRIVATE_KEYS_DIR="$keys_dir" xcrun altool --upload-app -f "$ipa" -t ios --api-key "$key_id" --api-issuer "$issuer_id"
print "$build_number" > "$last_used_file"
print "Uploaded build $build_number. It shows up in TestFlight once processing finishes."
