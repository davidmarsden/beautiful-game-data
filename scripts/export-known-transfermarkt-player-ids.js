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
const inputPath = args.input || "data/transfermarkt/players-master.json";
const outputPath = args.output || "calibration/known-transfermarkt-player-ids.json";
const reportPath = args.report || "calibration/known-transfermarkt-player-ids-report.json";

const raw = JSON.parse(await readFile(inputPath, "utf8"));
const rows = Array.isArray(raw) ? raw : raw.players || [];
const ids = [...new Set(rows
  .map((row) => String(row.transfermarkt_id || row.player_id || "").trim())
  .filter((id) => /^\d+$/.test(id)))]
  .sort((a, b) => Number(a) - Number(b));

const report = {
  generated_at: new Date().toISOString(),
  source: inputPath,
  source_players: rows.length,
  valid_transfermarkt_ids: ids.length,
  missing_or_invalid_ids: rows.length - ids.length
};

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(ids, null, 2) + "\n", "utf8");
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

console.log(JSON.stringify(report, null, 2));
