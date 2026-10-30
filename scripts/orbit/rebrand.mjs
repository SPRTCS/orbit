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
];

const WHOLE_FILE = [[/(<key>CFBundleName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${NAME}$2`]];

const KEEP_LINE = [
  /Safe Storage/,
  /account: "Ardia"/,
  /NSLog\(/,
  /setFrame(UsingName|AutosaveName)/,
  /OUR_IMAGES/,
  /based on Ardia/,
  /Ardia\.sdef/,
  /Application Support\/Ardia\//,
];

const WORD = /\bArdia\b/g;

const TARGETS = [
  { dir: "apps/browser/src", ext: [".ts", ".tsx"], skip: [/\.test\./, /telemetry\/sanitize\.ts$/] },
  { dir: "apps/browser/src", ext: [".test.mjs"], skip: [/telemetry\/sanitize\.test\.mjs$/] },
  { dir: "packages/shell/ios", ext: [".swift"], stringsOnly: true },
  { dir: "packages/import/ios", ext: [".swift"], stringsOnly: true },
  {
    dir: "packages/sync/ios",
    ext: [".swift"],
    stringsOnly: true,
    skip: [/Legacy(Migration|DockTile)\.swift$/],
  },
  { dir: "apps/browser/macos/Ardia-macOS", ext: [".plist", ".sdef"], stringsOnly: false },
  { dir: "apps/browser/macos/Ardia-macOS", ext: [".entitlements"], stringsOnly: true },
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

function rebrandLine(line, target) {
  for (const [from, to] of [...URLS, ...ENGINE_KEYCHAIN_GROUPS]) line = line.split(from).join(to);
  for (const [pattern, to] of TEXT) line = line.replace(pattern, to);
  if (isComment(line) || KEEP_LINE.some((re) => re.test(line))) return line;
  return target.stringsOnly ? inStrings(line) : line.replace(WORD, NAME);
}

let changed = 0;
for (const target of TARGETS) {
  for (const path of files(join(root, target.dir), target.ext)) {
    if (target.skip?.some((re) => re.test(path))) continue;
    const before = readFileSync(path, "utf8");
    const after = WHOLE_FILE.reduce(
      (text, [pattern, to]) => text.replace(pattern, to),
      before
        .split("\n")
        .map((line) => rebrandLine(line, target))
        .join("\n"),
    );
    if (after === before) continue;
    changed++;
    console.log(`${check ? "would change" : "rebranded"} ${relative(root, path)}`);
    if (!check) writeFileSync(path, after);
  }
}
console.log(changed ? `${changed} file(s) ${check ? "need rebranding" : "rebranded"}` : "branding up to date");
if (check && changed) process.exit(1);
