import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

const currentPath = process.argv[2] || "derived/player-database/player-database.json";
const previousPath = process.argv[3] || "derived/player-database/player-database-previous.json";
const metadataPath = "derived/player-database/player-database-previous-meta.json";

if (!(await exists(currentPath))) {
  console.log(`No current player database at ${currentPath}; first edition will become the baseline.`);
  process.exit(0);
}

const current = JSON.parse(await readFile(currentPath, "utf8"));
await mkdir(dirname(previousPath), { recursive: true });
await copyFile(currentPath, previousPath);
await writeFile(metadataPath, JSON.stringify({
  captured_at: new Date().toISOString(),
  source: currentPath,
  players: Array.isArray(current) ? current.length : current.players?.length || 0
}, null, 2) + "\n", "utf8");
console.log(`Preserved previous database edition: ${previousPath}`);
