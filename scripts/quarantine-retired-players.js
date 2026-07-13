import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const masterPath = args.master || "data/transfermarkt/players-master.json";
const reportPath = args.report || "calibration/retired-player-quarantine-report.json";
const masterRaw = JSON.parse(await readFile(masterPath, "utf8"));
const rows = Array.isArray(masterRaw) ? masterRaw : masterRaw.players || [];
const quarantined = [];

for (const row of rows) {
  const statusText = [row.status, row.player_status, row.current_status, row.current_club]
    .map((value) => String(value ?? "").trim())
    .join(" ");
  if (!/\bretired\b/i.test(statusText)) continue;
  row.status = "retired";
  row.player_status = "retired";
  row.eligible_for_matches = false;
  row.eligible_for_transfer = false;
  row.tbg_force_include = false;
  row.retired_quarantined_at = new Date().toISOString();
  quarantined.push({
    transfermarkt_id: String(row.transfermarkt_id || row.player_id || ""),
    player_name: row.display_name || row.full_name || "",
    age: row.age ?? null,
    current_club: row.current_club || "",
    market_value_eur: Number(row.market_value_eur || 0)
  });
}

const report = {
  generated_at: new Date().toISOString(),
  master_players: rows.length,
  quarantined_players: quarantined.length,
  principle: "Retired players remain in the historical Transfermarkt master but are ineligible for matches, transfers and publication in the active TBG player database.",
  players: quarantined
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(masterPath, JSON.stringify(masterRaw, null, 2) + "\n", "utf8");
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ master_players: rows.length, quarantined_players: quarantined.length }, null, 2));
