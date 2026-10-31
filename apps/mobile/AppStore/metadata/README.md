# Store metadata

`de-DE.json` and `en-US.json` contain the localized copy, URLs and keywords. `release-settings.json` records shared release settings. `review-notes.txt` contains reviewer instructions. Personal App Review contact details are maintained only in App Store Connect.

The preferred name “Orbit Browser” was unavailable in App Store Connect; the submitted name is “Orbit Browser Mobile”. German is the primary store locale. The app interface is currently English, as disclosed in both descriptions.

The first release has no App Store What's New field; the prepared `whatsNew` text is retained here for reuse. All other applicable text fields were saved to App Store Connect.

App Privacy was reviewed against the mobile source, the shared sync cryptography and the dependency list. There is no developer-operated collection endpoint, advertising SDK or analytics SDK. Browsing and optional search suggestions send requests directly to the selected website or search provider. Optional sync encrypts content before writing it to the user's own iCloud Drive folder. The bilingual privacy policy explains these distinctions. “Data Not Collected” was published through the signed-in App Store Connect website.

Validation for build 1: Release archive/export/upload succeeded; App Store Connect processed the build as VALID and APP_STORE_ELIGIBLE; 54 app tests and 41 sync tests passed. Screenshots were captured on iPhone and iPad simulators. Demo data is compiled only into Debug builds; its marker is absent from the Release binary. The privacy manifest is present in the archived app.
