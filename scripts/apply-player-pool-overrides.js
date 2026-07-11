import { readFile, writeFile } from "node:fs/promises";

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

const master = JSON.parse(await readFile("data/transfermarkt/players-master.json", "utf8"));
const config = JSON.parse(await readFile("data/config/player-status-overrides.json", "utf8"));
const ratings = parseCsv(await readFile("calibration/tbg-rating-scores.csv", "utf8"));
const globalPath = "derived/tbg-player-pools/global-players.json";
const unsignedPath = "derived/tbg-player-pools/unsigned-players.json";
const globalPlayers = JSON.parse(await readFile(globalPath, "utf8"));
const unsignedPlayers = JSON.parse(await readFile(unsignedPath, "utf8"));
const masterRows = Array.isArray(master) ? master : (master.players || []);
const ratingsById = new Map(ratings.map((row) => [String(row.transfermarktId || row.transfermarkt_id || ""), row]));

function idOf(row) { return String(row.transfermarkt_id || row.transfermarkt_player_id || row.player_id || ""); }
function number(value, fallback = null) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }

for (const [id, override] of Object.entries(config.players || {})) {
  let player = globalPlayers.find((row) => idOf(row) === id);
  const source = masterRows.find((row) => idOf(row) === id);
  if (!player && override.force_include && source) {
    const rating = ratingsById.get(id) || {};
    player = {
      tbg_player_id: rating.tbgPlayerId || `tbg-tm-${id.padStart(8, "0")}`,
      transfermarkt_id: id,
      display_name: source.display_name || source.full_name || override.display_name || "",
      full_name: source.full_name || source.display_name || override.display_name || "",
      date_of_birth: source.date_of_birth || "",
      age: number(source.age),
      nationality: Array.isArray(source.nationality) ? source.nationality : [],
      position: source.position || rating.position || "",
      position_group: rating.positionGroup || "UNK",
      current_club: source.current_club || "",
      current_club_id: source.current_club_id || "",
      current_competition_code: source.current_competition_code || "",
      market_value_eur: number(source.market_value_eur, 0),
      tbg_rating: number(rating.underlyingAbilityRating || rating.tbgRating),
      underlying_ability_rating: number(rating.underlyingAbilityRating || rating.tbgRating),
      effective_match_rating: number(rating.effectiveMatchRating || rating.tbgRating),
      rating_band: rating.tbgRatingBand || "",
      assignment_status: "unsigned",
      tbg_club_id: "",
      tbg_club_name: "",
      profile_url: source.profile_url || "",
      photo_url: source.photo_url || ""
    };
    globalPlayers.push(player);
    unsignedPlayers.push(player);
  }
  if (!player) continue;
  player.status = override.status || player.status;
  player.eligible_for_matches = override.eligible_for_matches !== false;
  player.eligible_for_transfer = override.eligible_for_transfer !== false;
  player.status_override_reason = override.reason || "";
  const unsigned = unsignedPlayers.find((row) => idOf(row) === id);
  if (unsigned) Object.assign(unsigned, {
    status: player.status,
    eligible_for_matches: player.eligible_for_matches,
    eligible_for_transfer: player.eligible_for_transfer,
    status_override_reason: player.status_override_reason
  });
}

globalPlayers.sort((a, b) => number(b.tbg_rating, 0) - number(a.tbg_rating, 0));
unsignedPlayers.sort((a, b) => number(b.tbg_rating, 0) - number(a.tbg_rating, 0));
await writeFile(globalPath, JSON.stringify(globalPlayers, null, 2) + "\n", "utf8");
await writeFile(unsignedPath, JSON.stringify(unsignedPlayers, null, 2) + "\n", "utf8");
console.log(`Applied pool overrides. Global players: ${globalPlayers.length}`);
