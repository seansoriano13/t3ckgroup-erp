#!/usr/bin/env node
/**
 * Prepends a release entry to src/data/changelog.json — the file Settings
 * and the "What's New" modal read as the app's current version. Replaces
 * add-changelog.ps1, which had the next release's version/title/bullets
 * hardcoded in the script body and had to be hand-edited every time.
 *
 * Usage:
 *   node scripts/add-changelog.mjs --version 1.8.0 --title "Version in Settings" \
 *     --change "Settings now shows which version you are running." \
 *     --change "Another bullet, one flag per line."
 *
 * Refuses to run if --version is already in the file (see scripts/lib/changelog.mjs).
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { addEntry } from "./lib/changelog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const changelogPath = join(__dirname, "..", "src", "data", "changelog.json");

function parseArgs(argv) {
  const result = { version: null, title: null, changes: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--version") {
      result.version = argv[++i];
    } else if (arg === "--title") {
      result.title = argv[++i];
    } else if (arg === "--change") {
      result.changes.push(argv[++i]);
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  return result;
}

function main() {
  const { version, title, changes } = parseArgs(process.argv.slice(2));

  if (!version || !title || changes.length === 0) {
    console.error(
      'Usage: node scripts/add-changelog.mjs --version 1.8.0 --title "Title" --change "First bullet." [--change "Second bullet."]',
    );
    process.exit(1);
  }

  const existing = JSON.parse(readFileSync(changelogPath, "utf8"));
  const updated = addEntry(existing, { version, title, changes });

  writeFileSync(changelogPath, JSON.stringify(updated, null, 4), "utf8");

  console.log(`Added v${version} — "${title}" (${updated[0].date}) to src/data/changelog.json`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
