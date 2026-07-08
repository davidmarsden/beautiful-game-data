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

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rating(player) {
  return Number(player.underlying_ability_rating ?? player.tbg_rating ?? player.effective_match_rating ?? 0) || 0;
}

function value(player) {
  return Number(player.market_value_eur ?? player.value_eur ?? 0) || 0;
}

function ratingBand(score) {
  if (score >= 93) return "world_elite";
  if (score >= 90) return "elite";
  if (score >= 87) return "top_tier";
  if (score >= 84) return "first_team";
  if (score >= 80) return "senior_squad";
  return "development";
}

async function readJson(path, fallback = []) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function writeCsv(path, rows, columns) {
  await mkdir(dirname(path), { recursive: true });
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")).join("\n");
  await writeFile(path, `${header}\n${body}\n`, "utf8");
}

const args = parseArgs(process.argv.slice(2));
const globalPlayersPath = args.globalPlayers ?? "derived/tbg-player-pools/global-players.json";
const gamePlayersPath = args.gamePlayers ?? "derived/tbg-player-pools/game-players.json";
const unsignedPlayersPath = args.unsignedPlayers ?? "derived/tbg-player-pools/unsigned-players.json";
const outputJson = args.outputJson ?? "derived/player-database/player-database.json";
const outputCsv = args.outputCsv ?? "derived/player-database/player-database.csv";
const summaryPath = args.summary ?? "derived/player-database/player-database-summary.json";

const [globalPlayers, gamePlayers, unsignedPlayers] = await Promise.all([
  readJson(globalPlayersPath, []),
  readJson(gamePlayersPath, []),
  readJson(unsignedPlayersPath, [])
]);

const source = globalPlayers.length ? globalPlayers : [...gamePlayers, ...unsignedPlayers];
const rows = source
  .map((player) => {
    const score = rating(player);
    return {
      tbg_player_id: player.tbg_player_id || "",
      transfermarkt_player_id: player.transfermarkt_player_id || player.source_player_id || "",
      player_name: player.display_name || player.name || "",
      age: player.age ?? "",
      date_of_birth: player.date_of_birth || "",
      nationality: Array.isArray(player.nationalities) ? player.nationalities.join("; ") : (player.nationality || ""),
      current_club: player.current_club || player.tbg_club_name || "Without Club",
      current_club_id: player.current_club_id || player.real_club_source_id || "",
      tbg_club: player.tbg_club_name || "",
      position: player.position || player.primary_position || "",
      position_group: player.position_group || "",
      market_value_eur: value(player),
      tbg_rating: Number(score.toFixed(2)),
      rating_band: player.rating_band || ratingBand(score),
      status: player.status || "active",
      assignment_status: player.assignment_status || "global",
      is_new_player: Boolean(player.is_new_player || player.new_player),
      is_watchlist: Boolean(player.is_watchlist || player.watchlist),
      source: player.source || player.source_system || "transfermarkt"
    };
  })
  .filter((row) => row.tbg_player_id || row.player_name)
  .sort((a, b) => Number(b.tbg_rating) - Number(a.tbg_rating) || Number(b.market_value_eur) - Number(a.market_value_eur) || String(a.player_name).localeCompare(String(b.player_name)));

const columns = [
  "tbg_player_id",
  "transfermarkt_player_id",
  "player_name",
  "age",
  "date_of_birth",
  "nationality",
  "current_club",
  "current_club_id",
  "tbg_club",
  "position",
  "position_group",
  "market_value_eur",
  "tbg_rating",
  "rating_band",
  "status",
  "assignment_status",
  "is_new_player",
  "is_watchlist",
  "source"
];

const summary = {
  generated_at: new Date().toISOString(),
  players: rows.length,
  assigned_players: rows.filter((row) => row.assignment_status === "assigned").length,
  without_club: rows.filter((row) => row.status === "without_club" || row.current_club === "Without Club").length,
  new_players: rows.filter((row) => row.is_new_player).length,
  watchlist_players: rows.filter((row) => row.is_watchlist).length,
  rating_bands: rows.reduce((memo, row) => {
    memo[row.rating_band] = (memo[row.rating_band] || 0) + 1;
    return memo;
  }, {})
};

await writeJson(outputJson, rows);
await writeCsv(outputCsv, rows, columns);
await writeJson(summaryPath, summary);

console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote player database JSON: ${outputJson}`);
console.log(`Wrote player database CSV: ${outputCsv}`);
