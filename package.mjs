// Bundles the built plugin into a shareable zip.
//
//   npm run package        # build (via prepackage) then zip
//   node package.mjs       # zip whatever is already built
//
// Produces dist/cards-<version>.zip containing a `cards/` folder with the
// three files Obsidian needs: main.js, manifest.json, styles.css.
//
// The recipient unzips it into their vault's .obsidian/plugins/ folder, so
// they end up with .obsidian/plugins/cards/{main.js,manifest.json,styles.css},
// then enables "Cards" under Settings → Community plugins.

import { mkdir, rm, copyFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const run = promisify(execFile);

const { id, version } = JSON.parse(await readFile("manifest.json", "utf8"));
const files = ["main.js", "manifest.json", "styles.css"];

// Stage the files under dist/<id>/ so the zip contains the folder Obsidian expects.
const dist = "dist";
const staged = join(dist, id);
await rm(dist, { recursive: true, force: true });
await mkdir(staged, { recursive: true });

for (const file of files) {
	await copyFile(file, join(staged, file));
}

// Zip from inside dist/ so the archive root is `cards/`, not `dist/cards/`.
const zipName = `${id}-${version}.zip`;
await run("zip", ["-r", zipName, id], { cwd: dist });

console.log(`✓ Created ${join(dist, zipName)}`);
console.log(`  Share it — the recipient unzips into their vault's .obsidian/plugins/ folder.`);
