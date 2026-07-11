import { readFile, writeFile } from "node:fs/promises";

const masterPath = "data/transfermarkt/players-master.json";
const overridesPath = "data/config/player-status-overrides.json";

const master = JSON.parse(await readFile(masterPath, "utf8"));
const config = JSON.parse(await readFile(overridesPath, "utf8"));
const rows = Array.isArray(master) ? master : (master.players || []);
const overrides = config.players || {};
let applied = 0;
let missing = 0;

for (const [id, override] of Object.entries(overrides)) {
  const player = rows.find((row) => String(row.transfermarkt_id || row.transfermarkt_player_id || row.player_id || "") === String(id));
  if (!player) {
    missing += 1;
    console.log(`Override target not in local master: ${id} ${override.display_name || ""}`);
    continue;
  }
  player.status = override.status;
  player.player_status = override.status;
  player.tbg_force_include = Boolean(override.force_include);
  player.eligible_for_matches = override.eligible_for_matches !== false;
  player.eligible_for_transfer = override.eligible_for_transfer !== false;
  player.status_override_reason = override.reason || "";
  applied += 1;
}

await writeFile(masterPath, JSON.stringify(master, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ applied, missing }, null, 2));
