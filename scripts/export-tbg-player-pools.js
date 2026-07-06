import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

async function readJson(path, fallback) {
  try {
    await access(path);
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...body] = rows.filter((item) => item.length > 1);
  if (!headers) return [];
  return body.map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index] ?? ""])));
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  if (/[,"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(records, headers) {
  return [headers.join(","), ...records.map((record) => headers.map((header) => csvEscape(record[header])).join(","))].join("\n") + "\n";
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normaliseStatus(row) {
  const raw = String(row.status || row.player_status || row.transfermarkt_status || "").trim().toLowerCase();
  const club = String(row.current_club || "").trim().toLowerCase();
  if (raw.includes("retired")) return "retired";
  if (raw.includes("without") || raw.includes("free agent") || club === "without club") return "without_club";
  if (!row.current_club_id && club === "") return "unknown";
  return "active";
}

function positionGroup(position, positionCategory) {
  const value = `${position ?? ""} ${positionCategory ?? ""}`.toLowerCase();
  if (value.includes("goalkeeper")) return "GK";
  if (value.includes("back") || value.includes("defender")) return "DEF";
  if (value.includes("midfield")) return "MID";
  if (value.includes("wing") || value.includes("forward") || value.includes("striker")) return "ATT";
  return "UNK";
}

function assignmentKey(row) {
  return String(row.transfermarkt_id || row.transfermarktId || row.player_id || "").trim();
}

function buildRatingIndex(rows) {
  const byTmId = new Map();
  for (const row of rows) {
    const id = String(row.transfermarktId || row.transfermarkt_id || "").trim();
    if (id && !byTmId.has(id)) byTmId.set(id, row);
  }
  return byTmId;
}

function buildAssignmentIndex(assignments) {
  const byTmId = new Map();
  for (const row of assignments) {
    const id = assignmentKey(row);
    if (id) byTmId.set(id, row);
  }
  return byTmId;
}

function isEligibleForGlobal(row, policy, assigned) {
  if (assigned && policy.includeExistingGameAssignmentsRegardlessOfFilters) return true;
  const age = number(row.age, -1);
  const value = number(row.market_value_eur, 0);
  if (age < policy.minimumAge || age > policy.maximumAge) return false;
  if (value < policy.minimumMarketValueEur) return false;
  const status = normaliseStatus(row);
  if (status === "retired" && !policy.includeRetiredInGlobalDatabase) return false;
  if (status === "without_club" && !policy.includeWithoutClub) return false;
  return true;
}

function isGamePoolEligible(row, policy) {
  const status = row.status;
  if (status === "retired" && policy.excludeRetiredFromGamePools) return false;
  return true;
}

function canonicalPlayer(tmRow, ratingRow, assignment) {
  const id = String(tmRow.transfermarkt_id || tmRow.player_id || "");
  const status = normaliseStatus(tmRow);
  return {
    tbg_player_id: ratingRow?.tbgPlayerId || `tbg-tm-${id.padStart(8, "0")}`,
    transfermarkt_id: id,
    display_name: tmRow.display_name || tmRow.full_name || ratingRow?.playerName || "",
    full_name: tmRow.full_name || tmRow.display_name || "",
    name_key: tmRow.name_key || "",
    date_of_birth: tmRow.date_of_birth || "",
    age: number(tmRow.age, null),
    status,
    nationality: Array.isArray(tmRow.nationality) ? tmRow.nationality : [],
    position: tmRow.position || ratingRow?.position || "",
    position_group: ratingRow?.positionGroup || positionGroup(tmRow.position, tmRow.position_category),
    foot: tmRow.foot || "",
    height_cm: number(tmRow.height_cm, null),
    current_club: tmRow.current_club || "",
    current_club_id: tmRow.current_club_id || "",
    current_competition_code: tmRow.current_competition_code || "",
    contract_until: tmRow.contract_until || "",
    market_value_eur: number(tmRow.market_value_eur, 0),
    highest_market_value_eur: number(tmRow.highest_market_value_eur, 0),
    international_team: tmRow.international_team || "",
    international_caps: number(tmRow.international_caps, 0),
    tbg_rating: ratingRow?.tbgRating ? number(ratingRow.tbgRating, null) : null,
    smw_equivalent_rating: ratingRow?.smwEquivalentRating ? number(ratingRow.smwEquivalentRating, null) : null,
    rating_band: ratingRow?.tbgRatingBand || "",
    tbg_club_id: assignment?.tbg_club_id || assignment?.tbgClubId || "",
    tbg_club_name: assignment?.tbg_club_name || assignment?.tbgClubName || "",
    owner_manager: assignment?.owner_manager || assignment?.ownerManager || "",
    assignment_status: assignment ? "assigned" : "unsigned",
    first_seen_at: tmRow.first_seen_at || tmRow.scraped_at || "",
    last_seen_at: tmRow.scraped_at || "",
    profile_url: tmRow.profile_url || "",
    photo_url: tmRow.photo_url || ""
  };
}

function sortByValueAndRating(a, b) {
  return number(b.tbg_rating) - number(a.tbg_rating) || number(b.market_value_eur) - number(a.market_value_eur) || String(a.display_name).localeCompare(String(b.display_name));
}

function sortWatchlist(a, b) {
  return number(a.age, 99) - number(b.age, 99) || number(b.market_value_eur) - number(a.market_value_eur) || number(b.tbg_rating) - number(a.tbg_rating) || String(a.display_name).localeCompare(String(b.display_name));
}

function recentCutoffIso(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

const args = parseArgs(process.argv.slice(2));
const configPath = args.config ?? "data/config/tbg-player-pipeline.json";
const transfermarktPath = args.transfermarkt ?? "data/transfermarkt/players-master.json";
const ratingsPath = args.ratings ?? "calibration/tbg-rating-scores.csv";
const assignmentsPath = args.assignments ?? "data/game/player-assignments.json";
const submissionsPath = args.submissions ?? "data/submissions/transfermarkt-player-submissions.json";
const outputDir = args.outputDir ?? "derived/tbg-player-pools";

const config = await readJson(configPath, {});
const policy = config.importPolicy ?? {};
const watchlistPolicy = config.watchlistPolicy ?? {};
const newPlayersPolicy = config.newPlayersPolicy ?? {};
const transfermarktRows = await readJson(transfermarktPath, []);
const ratingRows = parseCsv(await readFile(ratingsPath, "utf8"));
const assignments = await readJson(assignmentsPath, []);
const submissions = await readJson(submissionsPath, []);
const ratingsByTmId = buildRatingIndex(ratingRows);
const assignmentsByTmId = buildAssignmentIndex(assignments);

const globalPlayers = transfermarktRows
  .map((tmRow) => canonicalPlayer(tmRow, ratingsByTmId.get(String(tmRow.transfermarkt_id || tmRow.player_id || "")), assignmentsByTmId.get(String(tmRow.transfermarkt_id || tmRow.player_id || ""))))
  .filter((player) => isEligibleForGlobal(player, policy, Boolean(player.tbg_club_id)))
  .sort(sortByValueAndRating);

const gamePlayers = globalPlayers
  .filter((player) => player.assignment_status === "assigned")
  .sort((a, b) => String(a.tbg_club_name).localeCompare(String(b.tbg_club_name)) || sortByValueAndRating(a, b));

const unsignedPlayers = globalPlayers
  .filter((player) => player.assignment_status === "unsigned" && isGamePoolEligible(player, policy))
  .sort(sortByValueAndRating);

const watchlistPlayers = unsignedPlayers
  .filter((player) => number(player.age, 99) <= number(watchlistPolicy.maximumAge, 21))
  .filter((player) => number(player.market_value_eur, 0) >= number(watchlistPolicy.minimumMarketValueEur, 0))
  .sort(sortWatchlist)
  .slice(0, number(watchlistPolicy.maximumRows, 1000));

const cutoff = recentCutoffIso(number(newPlayersPolicy.lookbackDays, 30));
const newPlayers = unsignedPlayers
  .filter((player) => player.first_seen_at && player.first_seen_at >= cutoff)
  .filter((player) => number(player.age, 99) <= number(newPlayersPolicy.maximumAge, 21))
  .filter((player) => number(player.market_value_eur, 0) >= number(newPlayersPolicy.minimumMarketValueEur, 0))
  .sort(sortWatchlist);

const submissionRows = submissions.map((submission) => ({
  submitted_at: submission.submitted_at || submission.submittedAt || "",
  submitted_by: submission.submitted_by || submission.submittedBy || "",
  transfermarkt_url: submission.transfermarkt_url || submission.transfermarktUrl || submission.url || "",
  transfermarkt_id: submission.transfermarkt_id || submission.transfermarktId || "",
  status: submission.status || "pending",
  notes: submission.notes || ""
}));

const summary = {
  generated_at: new Date().toISOString(),
  global_players: globalPlayers.length,
  game_players: gamePlayers.length,
  unsigned_players: unsignedPlayers.length,
  watchlist_players: watchlistPlayers.length,
  new_players: newPlayers.length,
  submitted_players: submissionRows.length,
  status_counts: globalPlayers.reduce((memo, player) => {
    memo[player.status] = (memo[player.status] ?? 0) + 1;
    return memo;
  }, {}),
  policy
};

await mkdir(outputDir, { recursive: true });
const outputs = [
  ["global-players.json", globalPlayers],
  ["game-players.json", gamePlayers],
  ["unsigned-players.json", unsignedPlayers],
  ["watchlist-players.json", watchlistPlayers],
  ["new-players.json", newPlayers],
  ["submitted-players.json", submissionRows],
  ["summary.json", summary]
];
for (const [file, data] of outputs) {
  await writeFile(`${outputDir}/${file}`, JSON.stringify(data, null, 2) + "\n", "utf8");
}

const csvHeaders = [
  "tbg_player_id",
  "transfermarkt_id",
  "display_name",
  "age",
  "status",
  "nationality",
  "position",
  "position_group",
  "current_club",
  "current_competition_code",
  "market_value_eur",
  "tbg_rating",
  "smw_equivalent_rating",
  "rating_band",
  "assignment_status",
  "tbg_club_name",
  "profile_url"
];
await writeFile(`${outputDir}/global-players.csv`, writeCsv(globalPlayers, csvHeaders), "utf8");
await writeFile(`${outputDir}/unsigned-players.csv`, writeCsv(unsignedPlayers, csvHeaders), "utf8");
await writeFile(`${outputDir}/watchlist-players.csv`, writeCsv(watchlistPlayers, csvHeaders), "utf8");

console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote TBG player pools to ${outputDir}`);
