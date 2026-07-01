// Copies the built plugin into the Obsidian vault for testing.
//
//   npm run deploy          # build (via prebuild) then copy
//   node deploy.mjs         # copy whatever is already built
//
// The destination vault is read from the VAULT variable. Set it in a local
// .env file (see .env.example), or pass it inline:
//   VAULT="/path/to/vault" node deploy.mjs
//
// Only the plugin assets are copied — data.json (your settings) is left alone.

import { copyFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";

// Load .env if present; a missing file is fine (VAULT may be set another way).
try {
	process.loadEnvFile(".env");
} catch {
	// no .env — fall through to whatever is already in the environment
}

const vault = process.env.VAULT;
if (!vault) {
	console.error("✗ VAULT is not set.");
	console.error("  Copy .env.example to .env and set VAULT to your vault path.");
	process.exit(1);
}

const dest = join(vault, ".obsidian", "plugins", "cards");
const files = ["main.js", "manifest.json", "styles.css"];

try {
	await access(vault);
} catch {
	console.error(`✗ Vault not found: ${vault}`);
	console.error("  Check the VAULT path in your .env file and retry.");
	process.exit(1);
}

await mkdir(dest, { recursive: true });

for (const file of files) {
	await copyFile(file, join(dest, file));
	console.log(`✓ ${file} → ${dest}`);
}

console.log("Done. Hot Reload should pick up the change automatically.");
