import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function parseArgs(argv) {
  return Object.fromEntries(argv.map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
}

async function readJson(path, fallback = []) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

function rowsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.players)) return value.players;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") ?? "";
}

function number(...values) {
  const value = first(...values);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const args = parseArgs(process.argv.slice(2));
const input = args.input ?? "data/transfermarkt/players-master.json";
const output = args.output ?? "derived/player-universe/wider-player-registry.json";
const summaryOutput = args.summary ?? "derived/player-universe/wider-player-registry-summary.json";
const source = rowsFrom(await readJson(input, []));

const byId = new Map();
for (const player of source) {
  const id = String(first(player.transfermarkt_player_id, player.player_id, player.id, player.source_player_id)).trim();
  if (!id) continue;
  const row = {
    transfermarkt_player_id: id,
    player_name: first(player.player_name, player.display_name, player.name),
    date_of_birth: first(player.date_of_birth, player.birth_date, player.dateOfBirth),
    age: number(player.age),
    nationality: Array.isArray(player.nationalities) ? player.nationalities.join("; ") : first(player.nationality, player.country),
    position: first(player.position, player.primary_position, player.detailed_position),
    current_club: first(player.current_club, player.club_name, player.club),
    current_club_id: String(first(player.current_club_id, player.transfermarkt_club_id, player.club_id)).trim(),
    market_value_eur: number(player.market_value_eur, player.market_value, player.value_eur),
    source_updated_at: first(player.source_updated_at, player.updated_at, player.scraped_at),
    source: "transfermarkt"
  };
  const existing = byId.get(id);
  if (!existing || row.market_value_eur >= existing.market_value_eur) byId.set(id, row);
}

const rows = [...byId.values()].sort((a, b) => b.market_value_eur - a.market_value_eur || a.player_name.localeCompare(b.player_name));
const summary = {
  generated_at: new Date().toISOString(),
  source: input,
  players: rows.length,
  with_market_value: rows.filter((row) => row.market_value_eur > 0).length,
  with_club: rows.filter((row) => row.current_club_id || row.current_club).length,
  under_24: rows.filter((row) => row.age > 0 && row.age <= 23).length
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(rows, null, 2) + "\n", "utf8");
await mkdir(dirname(summaryOutput), { recursive: true });
await writeFile(summaryOutput, JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote wider player registry: ${output}`);
