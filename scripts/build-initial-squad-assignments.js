import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const idOf = (row) => String(row.transfermarkt_id || row.player_id || row.transfermarktId || "").trim();
const clubIdOf = (row) => String(row.current_club_id || row.transfermarkt_club_id || row.club_id || "").trim();
const ageOf = (row) => num(row.age, 99);
const ratingOf = (row) => num(row.tbg_rating ?? row.underlying_ability_rating ?? row.underlyingAbilityRating, 0);
const valueOf = (row) => num(row.market_value_eur ?? row.marketValueEur, 0);

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

function comparePlayers(a, b) {
  return ratingOf(b) - ratingOf(a)
    || valueOf(b) - valueOf(a)
    || ageOf(a) - ageOf(b)
    || String(a.display_name || a.player_name || "").localeCompare(String(b.display_name || b.player_name || ""));
}

const args = parseArgs(process.argv.slice(2));
const masterPath = args.master ?? "data/transfermarkt/players-master.json";
const ratingsPath = args.ratings ?? "derived/tbg-player-pools/global-players.json";
const universePath = args.universe ?? "data/config/tbg-club-universe.json";
const configPath = args.config ?? "data/config/initial-squad-policy.json";
const outputPath = args.output ?? "data/game/player-assignments.json";
const summaryPath = args.summary ?? "derived/initial-squads/initial-squad-summary.json";

const [master, ratedPlayers, universe, policy] = await Promise.all([
  readJson(masterPath),
  readJson(ratingsPath),
  readJson(universePath),
  readJson(configPath)
]);

const ratingsById = new Map(ratedPlayers.map((row) => [idOf(row), row]));
const clubsById = new Map((universe.clubs || []).map((club) => [String(club.transfermarkt_club_id), club]));
const grouped = new Map();

for (const player of master) {
  const clubId = clubIdOf(player);
  if (!clubsById.has(clubId)) continue;
  if (!grouped.has(clubId)) grouped.set(clubId, []);
  grouped.get(clubId).push({ ...player, ...(ratingsById.get(idOf(player)) || {}) });
}

const assignments = [];
const clubSummaries = [];
for (const club of universe.clubs || []) {
  const clubId = String(club.transfermarkt_club_id);
  const squad = (grouped.get(clubId) || []).sort(comparePlayers);
  const youth = squad.filter((player) => ageOf(player) <= policy.youth_max_age).slice(0, policy.initial_youth_limit);
  const youthIds = new Set(youth.map(idOf));
  const senior = squad.filter((player) => ageOf(player) > policy.youth_max_age && !youthIds.has(idOf(player))).slice(0, policy.initial_first_team_limit);
  const selected = [
    ...senior.map((player) => ({ player, squad: "first_team" })),
    ...youth.map((player) => ({ player, squad: "youth" }))
  ];

  for (const { player, squad: squadType } of selected) {
    assignments.push({
      transfermarkt_id: idOf(player),
      tbg_club_id: `tbg-club-${clubId}`,
      tbg_club_name: club.name,
      squad: squadType,
      assignment_source: "initial_real_world_squad",
      assigned_at: new Date().toISOString()
    });
  }

  clubSummaries.push({
    slot: club.slot,
    club_name: club.name,
    transfermarkt_club_id: clubId,
    available_real_world_players: squad.length,
    initial_first_team_players: senior.length,
    initial_youth_players: youth.length,
    first_team_vacancies: policy.maximum_first_team_size - senior.length,
    youth_vacancies: policy.maximum_youth_size - youth.length,
    unassigned_real_world_players: Math.max(0, squad.length - selected.length)
  });
}

const summary = {
  generated_at: new Date().toISOString(),
  policy,
  clubs: clubSummaries.length,
  assigned_players: assignments.length,
  first_team_players: assignments.filter((row) => row.squad === "first_team").length,
  youth_players: assignments.filter((row) => row.squad === "youth").length,
  club_summaries: clubSummaries
};

for (const path of [outputPath, summaryPath]) await mkdir(dirname(path), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(assignments, null, 2)}\n`, "utf8");
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`Built ${assignments.length} initial player assignment(s) across ${clubSummaries.length} clubs.`);
console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${summaryPath}`);
