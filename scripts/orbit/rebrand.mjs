#!/usr/bin/env node
const HELP = `Usage: node scripts/orbit/rebrand.mjs [--check]

Applies Orbit's branding on top of upstream Ardia. Run it after every upstream
merge. --check only reports files that still need rebranding. See docs/orbit.md.`;

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const check = process.argv.includes("--check");

const NAME = "Orbit";
const REPO = "SPRTCS/orbit";

const URLS = [
  ["https://ardia.dev/switches.json", `https://raw.githubusercontent.com/${REPO}/orbit/switches.json`],
  ["https://ardia.dev/appcast.xml", `https://github.com/${REPO}/releases/latest/download/appcast.xml`],
  ["https://github.com/mantrakp04/ardia/releases/latest/download/appcast.xml", `https://github.com/${REPO}/releases/latest/download/appcast.xml`],
  ["https://ardia.dev/release-notes", `https://github.com/${REPO}/releases`],
  ["https://github.com/mantrakp04/ardia/issues", `https://github.com/${REPO}/issues`],
  ['"https://github.com/mantrakp04/ardia"', `"https://github.com/${REPO}"`],
];

const ENGINE_KEYCHAIN_GROUPS = [
  ["$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER).", "$(AppIdentifierPrefix)com.ardia.browser."],
];

const TEXT = [
  ["© 2026 Mantra Patel. Ardia is open source under the Apache License 2.0.", `${NAME} is open source under the Apache License 2.0, based on Ardia © 2026 Mantra Patel.`],
  [/const SOURCE_NOTICE = ".*";/, `const SOURCE_NOTICE = "${NAME} is open source under the Apache License 2.0, based on Ardia by Mantra Patel.";`],
  ["Sent to ardia.dev with a random ID", "Sent with a random ID"],
  [/updateChecks: ".*",/, `updateChecks: "Update checks download ${NAME}'s release list from GitHub (${REPO}). GitHub sees your IP address and app version, like any download. Nothing else is sent.",`],
  ["reads ardia.dev/switches.json:", `reads switches.json from ${NAME}'s GitHub repository:`],
  ['tab.go_to("https://ardia.dev")', 'tab.go_to("https://example.com")'],
];

const COMMAND = [[/\bardia(?=(?: command| mcp | exec | --help|<\/Text>))/g, "orbit"]];

const SCHEME = [[/\bardia(?=:(?:\/\/|\\))/g, "orbit"]];

const LEGACY_SCHEME = '["ardia://", "orbit://"],';

const CLI_WORD = /(?<![\w/.$-])ardia(?=[ "'\\]|:(?!\/\/)|$)/g;

const CLI_PATH = /(?<=\/\.?)ardia(?![\w-])/g;

const CLI_SHELL = [["repo=mantrakp04/ardia", `repo=${REPO}`]];

const FILE_EDITS = {
  "packages/core/src/appUrls.ts": [
    ['const APP_SCHEME = "ardia";', 'const APP_SCHEME = "orbit";'],
    ["/^(view-source:)?ardia:(?:\\/\\/)?/i", "/^(view-source:)?(?:ardia|orbit):(?:\\/\\/)?/i"],
    ["/^ardia:\\/\\/[^/?#]/i", "/^(?:ardia|orbit):\\/\\/[^/?#]/i"],
  ],
  "packages/core/src/omnibox.ts": [['"ardia", "chrome",', '"ardia", "orbit", "chrome",']],
  "apps/browser/src/legacy.ts": [['  ["netnyahoo://", "ardia://"],\n', `  ["netnyahoo://", "orbit://"],\n  ${LEGACY_SCHEME}\n`]],
  "apps/browser/src/components/pages/urls.ts": [
    [
      "if (!url?.toLowerCase().startsWith(SCHEME)) return null;\n  const page = url.slice(SCHEME.length)",
      'if (!url || !/^(?:ardia|orbit):\\/\\//i.test(url)) return null;\n  const page = url.slice(url.indexOf("://") + 3)',
    ],
  ],
  "packages/ardiacore/ios/ArdiaCoreChromeWindow.mm": [['window.title = @"Ardia";', `window.title = @"${NAME}";`]],
  "packages/ardiacore/ios/ArdiaCoreServices.mm": [['@"Ardia Passwords.csv"', `@"${NAME} Passwords.csv"`]],
  "apps/cli/ardia_cli/endpoint.py": [['"Application Support" / "com.ardia.browser"', '"Application Support" / "com.aisconsulting.orbit"']],
  "apps/cli/pyproject.toml": [
    ['description = "The ardia command: drive a running Ardia from Python."', `description = "The orbit command: drive a running ${NAME} from Python."`],
    ['[project.scripts]\nardia = ', '[project.scripts]\norbit = '],
  ],
};

const SWIFT_CODE = [[/(?<!\?\? )ProcessInfo\.processInfo\.processName/g, '(Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? ProcessInfo.processInfo.processName)']];

const WHOLE_FILE = [[/(<key>CFBundleName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${NAME}$2`]];

const KEEP_LINE = [
  /Safe Storage/,
  /account: "Ardia"/,
  /NSLog\(/,
  /setFrame(UsingName|AutosaveName)/,
  /OUR_IMAGES/,
  /based on Ardia/,
  /Ardia\.sdef/,
];

const WORD = /\bArdia\b/g;

const TARGETS = [
  { dir: "apps/browser/src", ext: [".ts", ".tsx"], scheme: true, skip: [/\.test\./, /telemetry\/sanitize\.ts$/] },
  { dir: "apps/browser/src", ext: [".test.mjs"], scheme: true, skip: [/telemetry\/sanitize\.test\.mjs$/, /orbitScheme\.test\./] },
  { dir: "packages/core/src", ext: [".ts"], scheme: true, schemeOnly: true, skip: [/orbitScheme\.test\./] },
  { dir: "packages/shell/src", ext: [".ts", ".tsx"], stringsOnly: true },
  { dir: "packages/shell/ios", ext: [".swift"], stringsOnly: true, swiftCode: true },
  { dir: "packages/import/ios", ext: [".swift"], stringsOnly: true },
  {
    dir: "packages/sync/ios",
    ext: [".swift"],
    stringsOnly: true,
    skip: [/Legacy(Migration|DockTile)\.swift$/],
  },
  { dir: "apps/browser/macos/Ardia-macOS", ext: [".plist", ".sdef"], stringsOnly: false },
  { dir: "apps/browser/macos/Ardia-macOS", ext: [".entitlements"], stringsOnly: true },
  { dir: "apps/cli/ardia_cli", ext: [".py", ".md"], cli: "python" },
  { files: ["apps/cli/install.sh", "apps/cli/scripts/build.sh"], cli: "shell" },
];

function* files(dir, ext) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path, ext);
    else if (ext.some((e) => path.endsWith(e))) yield path;
  }
}

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

const inStrings = (line) => line.replace(/"(?:[^"\\]|\\.)*"/g, (lit) => lit.replace(WORD, NAME));

function rebrandCliLine(line, target) {
  if (target.cli === "shell") {
    for (const [from, to] of CLI_SHELL) line = line.split(from).join(to);
    line = line.replace(CLI_PATH, "orbit");
  }
  return line.replace(CLI_WORD, "orbit").replace(WORD, NAME);
}

function rebrandLine(line, target) {
  for (const [from, to] of [...URLS, ...ENGINE_KEYCHAIN_GROUPS]) line = line.split(from).join(to);
  for (const [pattern, to] of TEXT) line = line.replace(pattern, to);
  if (target.cli) return rebrandCliLine(line, target);
  if (isComment(line)) return line;
  if (target.scheme && !line.includes(LEGACY_SCHEME)) for (const [pattern, to] of SCHEME) line = line.replace(pattern, to);
  if (target.schemeOnly) return line;
  for (const [pattern, to] of COMMAND) line = line.replace(pattern, to);
  if (target.swiftCode) for (const [pattern, to] of SWIFT_CODE) line = line.replace(pattern, to);
  if (KEEP_LINE.some((re) => re.test(line))) return line;
  return target.stringsOnly ? inStrings(line) : line.replace(WORD, NAME);
}

const stale = [];

function applyFileEdits(path, text) {
  for (const [from, to] of FILE_EDITS[relative(root, path)] ?? []) {
    if (text.includes(to)) continue;
    if (!text.includes(from)) {
      stale.push(`${relative(root, path)}: ${from.split("\n")[0]}`);
      continue;
    }
    text = text.replace(from, to);
  }
  return text;
}

const targetFiles = (target) =>
  target.files ? target.files.map((file) => join(root, file)) : [...files(join(root, target.dir), target.ext)];

const lineTargets = new Set();
const edited = [
  ...TARGETS.map((target) => ({ target, paths: targetFiles(target).filter((path) => !target.skip?.some((re) => re.test(path))) })),
  { target: null, paths: Object.keys(FILE_EDITS).map((file) => join(root, file)) },
];

let changed = 0;
for (const { target, paths } of edited) {
  for (const path of paths) {
    if (!target && lineTargets.has(path)) continue;
    if (target) lineTargets.add(path);
    const before = readFileSync(path, "utf8");
    const edits = applyFileEdits(path, before);
    const after = target
      ? WHOLE_FILE.reduce(
          (text, [pattern, to]) => text.replace(pattern, to),
          edits
            .split("\n")
            .map((line) => rebrandLine(line, target))
            .join("\n"),
        )
      : edits;
    if (after === before) continue;
    changed++;
    console.log(`${check ? "would change" : "rebranded"} ${relative(root, path)}`);
    if (!check) writeFileSync(path, after);
  }
}
for (const rule of stale) console.log(`stale rule, upstream changed: ${rule}`);
console.log(changed ? `${changed} file(s) ${check ? "need rebranding" : "rebranded"}` : "branding up to date");
if ((check && changed) || stale.length) process.exit(1);
