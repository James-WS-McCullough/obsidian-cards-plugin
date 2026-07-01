// Copies the built plugin into the Obsidian vault for testing.
//
//   npm run deploy          # build (via prebuild) then copy
//   node deploy.mjs         # copy whatever is already built
//
// Override the destination vault with the VAULT env var:
//   VAULT="/path/to/vault" node deploy.mjs
//
// Only the plugin assets are copied — data.json (your settings) is left alone.

import { copyFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_VAULT =
	"/Users/james.mccullough/Library/Mobile Documents/iCloud~md~obsidian/Documents/notes";

const vault = process.env.VAULT || DEFAULT_VAULT;
const dest = join(vault, ".obsidian", "plugins", "cards");
const files = ["main.js", "manifest.json", "styles.css"];

try {
	await access(vault);
} catch {
	console.error(`✗ Vault not found: ${vault}`);
	console.error("  Set the VAULT env var to your vault path and retry.");
	process.exit(1);
}

await mkdir(dest, { recursive: true });

for (const file of files) {
	await copyFile(file, join(dest, file));
	console.log(`✓ ${file} → ${dest}`);
}

console.log("Done. Hot Reload should pick up the change automatically.");
