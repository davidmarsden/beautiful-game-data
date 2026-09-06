import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const args = parseArgs(process.argv.slice(2));
const universePath = args.universe ?? "data/config/tbg-club-universe.json";
const outputPath = args.output ?? "calibration/daily-transfermarkt-discovery-scope.json";
const batchSize = positiveInt(args.batchSize, 10);
const day = args.date ? new Date(`${args.date}T00:00:00Z`) : new Date();
if (Number.isNaN(day.getTime())) throw new Error(`Invalid --date value: ${args.date}`);

const universe = JSON.parse(await readFile(universePath, "utf8"));
const clubs = (universe.clubs || []).filter((club) => String(club.transfermarkt_club_id ?? "").trim());
if (!clubs.length) throw new Error("No playable clubs with Transfermarkt IDs found");

// Advance one batch per UTC calendar day. Weekend gaps simply move the window on,
// avoiding a permanently fixed Monday-Friday subset while keeping selection deterministic.
const epochDay = Math.floor(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) / 86400000);
const start = (epochDay * batchSize) % clubs.length;
const selected = Array.from({ length: Math.min(batchSize, clubs.length) }, (_, index) => clubs[(start + index) % clubs.length]);
const clubIds = selected.map((club) => String(club.transfermarkt_club_id));

const report = {
  generated_at: new Date().toISOString(),
  universe_version: universe.version,
  effective_date_utc: day.toISOString().slice(0, 10),
  playable_clubs_with_ids: clubs.length,
  batch_size: selected.length,
  rotation_start_index: start,
  club_ids: clubIds,
  clubs: selected.map((club) => ({
    slot: club.slot,
    name: club.name,
    transfermarkt_club_id: String(club.transfermarkt_club_id),
    country: club.country,
    continent: club.continent
  }))
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");

if (process.env.GITHUB_OUTPUT) {
  await writeFile(process.env.GITHUB_OUTPUT, `club_ids=${clubIds.join(",")}\nclub_count=${selected.length}\n`, { flag: "a" });
}

console.log(JSON.stringify({
  effective_date_utc: report.effective_date_utc,
  playable_clubs_with_ids: report.playable_clubs_with_ids,
  batch_size: report.batch_size,
  rotation_start_index: report.rotation_start_index,
  clubs: report.clubs.map((club) => club.name)
}, null, 2));
