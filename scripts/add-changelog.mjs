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
 *     --change "Another bullet, one flag per line." \
 *     --modules purchasing,sales.sors   # optional: who gets the popup (menu group or entry keys). Left out in a terminal, you are asked; empty = everyone
 *     --link /release-notes     # optional: What's New offers it as its main button
 *
 * Refuses to run if --version is already in the file (see scripts/lib/changelog.mjs).
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createInterface } from "readline/promises";
import { addEntry, parseModules } from "./lib/changelog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const changelogPath = join(__dirname, "..", "src", "data", "changelog.json");

function parseArgs(argv) {
  const result = { version: null, title: null, changes: [], link: null, modules: [], modulesGiven: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--version") {
      result.version = argv[++i];
    } else if (arg === "--title") {
      result.title = argv[++i];
    } else if (arg === "--change") {
      result.changes.push(argv[++i]);
    } else if (arg === "--modules") {
      result.modulesGiven = true;
      result.modules.push(...parseModules(argv[++i]));
    } else if (arg === "--link") {
      result.link = argv[++i];
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  return result;
}

// Who should the What's New popup open for? Asked when the flag is left out,
// so a release is not accidentally sent to everyone.
async function askModules() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      "Which modules is this for (comma separated, e.g. purchasing,sales.sors)? Leave empty for everyone: ",
    );
    return parseModules(answer);
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { version, title, changes, link } = args;
  let { modules } = args;

  if (!version || !title || changes.length === 0) {
    console.error(
      'Usage: node scripts/add-changelog.mjs --version 1.8.0 --title "Title" --change "First bullet." [--change "Second bullet."]',
    );
    process.exit(1);
  }

  if (!args.modulesGiven && process.stdin.isTTY) modules = await askModules();

  const existing = JSON.parse(readFileSync(changelogPath, "utf8"));
  const updated = addEntry(existing, { version, title, changes, link, modules });

  writeFileSync(changelogPath, JSON.stringify(updated, null, 4), "utf8");

  console.log(`Added v${version} — "${title}" (${updated[0].date}) to src/data/changelog.json`);
}

try {
  await main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
