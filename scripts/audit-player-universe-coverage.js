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

function idOf(player) {
  return String(player.transfermarkt_player_id || player.transfermarkt_id || player.transfermarktId || player.source_player_id || player.player_id || player.id || "").trim();
}
function clubIdOf(player) { return String(player.current_club_id || player.real_club_source_id || player.transfermarkt_club_id || player.club_id || "").trim(); }
function marketValue(player) { return Number(player.market_value_eur ?? player.market_value ?? player.value_eur ?? 0) || 0; }
function age(player) { return Number(player.age ?? 0) || 0; }
function nameOf(player) { return player.player_name || player.display_name || player.canonical_name || player.name || ""; }
function clubNameOf(player) { return player.current_club || player.club_name || player.club || ""; }
function statusOf(player) { return String(player.status || player.player_status || player.transfermarkt_status || "").toLowerCase(); }
function text(value) { return String(value ?? "").trim().toLowerCase(); }

function matchesRule(player, rule) {
  const value = marketValue(player);
  const playerAge = age(player);
  if (rule.minimum_market_value_eur && value < rule.minimum_market_value_eur) return false;
  if (rule.maximum_age && (!playerAge || playerAge > rule.maximum_age)) return false;
  if (rule.minimum_age && playerAge < rule.minimum_age) return false;
  return true;
}

function classifyDropout(player, missingStage, top80ClubIds) {
  const status = statusOf(player);
  const club = text(clubNameOf(player));
  const value = marketValue(player);
  const playerAge = age(player);
  const top80 = top80ClubIds.has(clubIdOf(player));
  const youthTeam = /\b(u1[789]|u2[01]|youth|academy)\b/.test(club);
  const reserveTeam = /\b(b|ii|reserves?)\b/.test(club) || youthTeam;
  const amateur = /amateur|oberliga|regional|non-league/.test(text(player.current_competition || player.competition_name || player.league));

  let category = "policy_filtered";
  let expected = true;
  let reason = "Excluded by current pool policy";

  if (status.includes("retired") || club === "retired") {
    category = "retired"; reason = "Player is retired";
  } else if (status.includes("suspend") || status.includes("ban")) {
    category = "suspended"; expected = false; reason = "Suspended player should remain visible but unavailable";
  } else if (club === "without club" || status.includes("free agent") || status.includes("without")) {
    category = "free_agent"; reason = value < 100000 ? "Free agent below minimum market-value threshold" : "Free agent excluded by policy";
  } else if (youthTeam) {
    category = value === 0 ? "zero_value_prospect" : "youth_team";
    expected = !(top80 && playerAge >= 15 && playerAge <= 23);
    reason = value === 0 ? "Youth player has no assigned market value" : "Player belongs to a youth team";
  } else if (reserveTeam) {
    category = "reserve_team"; reason = "Player belongs to a reserve/B team";
  } else if (amateur || value === 0 && !top80) {
    category = "amateur_or_unvalued"; reason = "Outside core world and has no market value";
  } else if (value < 100000) {
    category = "below_value_threshold"; reason = `Market value €${value.toLocaleString()} is below the €100,000 pool threshold`;
  } else if (playerAge > 50) {
    category = "above_age_limit"; reason = "Player exceeds the configured age ceiling";
  } else if (top80) {
    category = "unexpected_core_club_dropout"; expected = false; reason = "Active player at a Top 80 club should normally be retained";
  } else if (value >= 1000000 || playerAge <= 23 && value >= 100000) {
    category = "unexpected_priority_dropout"; expected = false; reason = "Player meets priority value/age criteria but was excluded";
  }

  if (missingStage === "players_master" && value > 0 && !status.includes("retired")) {
    expected = false;
    category = "unexpected_import_dropout";
    reason = "Present in raw import but absent from players master despite a market value";
  }

  return { category, expected, reason };
}

const args = parseArgs(process.argv.slice(2));
const paths = {
  raw: args.raw ?? "calibration/apify-transfermarkt-universe-dataset.json",
  master: args.master ?? "data/transfermarkt/players-master.json",
  registry: args.registry ?? "data/players/player-registry.json",
  global: args.global ?? "derived/tbg-player-pools/global-players.json",
  published: args.published ?? "derived/player-database/player-database.json",
  universe: args.universe ?? "data/config/tbg-club-universe.json",
  wider: args.wider ?? "derived/player-universe/wider-player-registry.json",
  policy: args.policy ?? "data/config/player-universe-policy.json"
};
const output = args.output ?? "derived/player-universe/player-universe-coverage-audit.json";
const markdownOutput = args.markdown ?? "derived/player-universe/player-universe-coverage-audit.md";

const [rawValue, masterValue, registryValue, globalValue, publishedValue, universeValue, widerValue, policy] = await Promise.all([
  readJson(paths.raw, []), readJson(paths.master, []), readJson(paths.registry, []), readJson(paths.global, []),
  readJson(paths.published, []), readJson(paths.universe, { clubs: [] }), readJson(paths.wider, []), readJson(paths.policy, {})
]);

const stageRows = [
  ["raw_import", rowsFrom(rawValue)],
  ["players_master", rowsFrom(masterValue)],
  ["player_registry", rowsFrom(registryValue)],
  ["rated_global_pool", rowsFrom(globalValue)],
  ["published_database", rowsFrom(publishedValue)]
];
const stages = stageRows.map(([name, rows]) => ({ name, rows, ids: new Set(rows.map(idOf).filter(Boolean)), byId: new Map(rows.map((row) => [idOf(row), row]).filter(([id]) => id)) }));
for (const stage of stages) if (stage.rows.length && !stage.ids.size) throw new Error(`${stage.name} contains ${stage.rows.length} rows but no recognised Transfermarkt IDs`);

const canonicalClubs = (universeValue.clubs || []).filter((club) => Number(club.slot) <= Number(policy.core_playable_world?.top_club_slots ?? 80));
const top80ClubIds = new Set(canonicalClubs.map((club) => String(club.transfermarkt_club_id)));
const published = rowsFrom(publishedValue);
const publishedByClub = new Map();
for (const player of published) {
  const clubId = clubIdOf(player);
  if (!clubId) continue;
  if (!publishedByClub.has(clubId)) publishedByClub.set(clubId, []);
  publishedByClub.get(clubId).push(player);
}

const minimumSquad = Number(policy.core_playable_world?.minimum_expected_squad_size ?? 18);
const top80Completeness = canonicalClubs.map((club) => {
  const players = publishedByClub.get(String(club.transfermarkt_club_id)) || [];
  return {
    slot: club.slot, club_name: club.name, transfermarkt_club_id: String(club.transfermarkt_club_id),
    country: club.country || "", continent: club.continent || "", published_players: players.length,
    rated_players: players.filter((player) => Number(player.tbg_rating) > 0).length,
    youngest_age: players.map(age).filter(Boolean).sort((a, b) => a - b)[0] || null,
    status: players.length >= minimumSquad ? "complete" : players.length ? "thin" : "missing"
  };
});

const wider = rowsFrom(widerValue);
const publishedIds = stages.at(-1).ids;
const externalPriority = wider.filter((player) => !publishedIds.has(idOf(player))).map((player) => ({
  ...player,
  matched_rules: (policy.external_priority_rules || []).filter((rule) => matchesRule(player, rule)).map((rule) => rule.name)
})).filter((player) => player.matched_rules.length).sort((a, b) => marketValue(b) - marketValue(a) || age(a) - age(b));

const dropouts = [];
const seen = new Set();
for (let index = 0; index < stages.length - 1; index += 1) {
  const from = stages[index];
  const to = stages[index + 1];
  for (const id of from.ids) {
    if (to.ids.has(id) || seen.has(id)) continue;
    seen.add(id);
    const player = from.byId.get(id) || {};
    const classification = classifyDropout(player, to.name, top80ClubIds);
    dropouts.push({
      transfermarkt_player_id: id,
      player_name: nameOf(player),
      current_club: clubNameOf(player),
      current_club_id: clubIdOf(player),
      age: age(player) || null,
      market_value_eur: marketValue(player),
      first_missing_stage: to.name,
      category: classification.category,
      expected_dropout: classification.expected,
      reason: classification.reason
    });
  }
}
dropouts.sort((a, b) => Number(a.expected_dropout) - Number(b.expected_dropout) || b.market_value_eur - a.market_value_eur || a.player_name.localeCompare(b.player_name));
const unexpectedDropouts = dropouts.filter((row) => !row.expected_dropout);
const dropoutCategories = dropouts.reduce((memo, row) => { memo[row.category] = (memo[row.category] || 0) + 1; return memo; }, {});

const report = {
  generated_at: new Date().toISOString(), paths,
  stages: stages.map((stage) => ({ name: stage.name, players: stage.rows.length, unique_transfermarkt_ids: stage.ids.size })),
  stage_dropouts: stages.slice(1).map((stage, index) => ({ from: stages[index].name, to: stage.name, missing_ids: [...stages[index].ids].filter((id) => !stage.ids.has(id)).length })),
  top80_summary: { expected_clubs: canonicalClubs.length, complete: top80Completeness.filter((club) => club.status === "complete").length, thin: top80Completeness.filter((club) => club.status === "thin").length, missing: top80Completeness.filter((club) => club.status === "missing").length },
  top80_clubs: top80Completeness,
  high_priority_external_missing_count: externalPriority.length,
  high_priority_external_missing: externalPriority,
  dropout_count: dropouts.length,
  dropout_categories: dropoutCategories,
  unexpected_dropout_count: unexpectedDropouts.length,
  unexpected_dropouts: unexpectedDropouts,
  dropouts
};

const lines = [
  "# Player Universe Coverage Audit", "", `Generated: ${report.generated_at}`, "",
  "## Pipeline stages", ...report.stages.map((stage) => `- ${stage.name}: ${stage.players} rows / ${stage.unique_transfermarkt_ids} unique TM IDs`), "",
  "## Top 80 squad completeness", `- Complete: ${report.top80_summary.complete}`, `- Thin: ${report.top80_summary.thin}`, `- Missing: ${report.top80_summary.missing}`, "",
  ...top80Completeness.filter((club) => club.status !== "complete").map((club) => `- ${club.slot}. ${club.club_name}: ${club.published_players} players (${club.status})`), "",
  "## High-priority external missing players", `Count: ${externalPriority.length}`, "",
  ...externalPriority.slice(0, 200).map((player) => `- ${player.player_name} (${player.age || "?"}) — ${player.current_club || "Unknown club"} — €${Math.round(marketValue(player) / 1000000)}m — ${player.matched_rules.join(", ")}`), "",
  "## Dropout categories", ...Object.entries(dropoutCategories).sort((a, b) => b[1] - a[1]).map(([category, count]) => `- ${category}: ${count}`), "",
  "## Unexpected dropouts", `Count: ${unexpectedDropouts.length}`, ...unexpectedDropouts.slice(0, 200).map((player) => `- ${player.player_name} — ${player.current_club || "Unknown club"} — ${player.first_missing_stage} — ${player.reason}`), "",
  "## Stage dropouts", ...report.stage_dropouts.map((item) => `- ${item.from} → ${item.to}: ${item.missing_ids}`)
];

await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
await mkdir(dirname(markdownOutput), { recursive: true });
await writeFile(markdownOutput, lines.join("\n") + "\n", "utf8");
console.log(JSON.stringify({ stages: report.stages, top80_summary: report.top80_summary, high_priority_external_missing_count: externalPriority.length, dropout_count: dropouts.length, dropout_categories: dropoutCategories, unexpected_dropout_count: unexpectedDropouts.length }, null, 2));
console.log(`Wrote audit JSON: ${output}`);
console.log(`Wrote audit Markdown: ${markdownOutput}`);
