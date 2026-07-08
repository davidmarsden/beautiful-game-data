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

function csvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

const args = parseArgs(process.argv.slice(2));
const universePath = args.universe ?? "data/config/tbg-club-universe.json";
const outputPath = args.output ?? "derived/tbg-club-universe/selected-import-scope.json";
const requestedIds = csvList(args.clubIds || args.ids);
const requestedSlots = csvList(args.slots).map(Number).filter(Number.isFinite);
const includeChangedRepairSet = args.repairSet !== "false";

const universe = JSON.parse(await readFile(universePath, "utf8"));
const clubs = universe.clubs || [];
const repairIds = includeChangedRepairSet ? [
  "585", "537", "2462", "330", "1444", "1234", "828", "2241", "3535",
  "3631", "2407", "7055", "664", "6603", "2068", "6356", "3342", "8054"
] : [];

const idsFromSlots = clubs
  .filter((club) => requestedSlots.includes(Number(club.slot)))
  .map((club) => club.transfermarkt_club_id);
const clubIds = unique([...requestedIds, ...idsFromSlots, ...repairIds]);
const selectedClubs = clubs.filter((club) => clubIds.includes(String(club.transfermarkt_club_id)) || requestedSlots.includes(Number(club.slot)));

const scope = {
  universe_version: universe.version,
  selected_clubs: selectedClubs.map((club) => ({
    slot: club.slot,
    name: club.name,
    transfermarkt_club_id: club.transfermarkt_club_id,
    continent: club.continent,
    country: club.country,
    league: club.league
  })),
  club_ids: clubIds,
  club_ids_csv: clubIds.join(",")
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(scope, null, 2) + "\n", "utf8");

if (process.env.GITHUB_OUTPUT) {
  await writeFile(process.env.GITHUB_OUTPUT, `club_ids=${scope.club_ids_csv}\n`, { flag: "a" });
}

console.log(JSON.stringify({ universe_version: scope.universe_version, club_ids: scope.club_ids.length, selected_clubs: scope.selected_clubs.length }, null, 2));
console.table(scope.selected_clubs.map((club) => ({ slot: club.slot, name: club.name, id: club.transfermarkt_club_id })));
