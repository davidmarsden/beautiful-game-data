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
  return String(player.transfermarkt_player_id || player.source_player_id || player.player_id || player.id || "").trim();
}

function clubIdOf(player) {
  return String(player.current_club_id || player.real_club_source_id || player.transfermarkt_club_id || player.club_id || "").trim();
}

function marketValue(player) {
  return Number(player.market_value_eur ?? player.market_value ?? player.value_eur ?? 0) || 0;
}

function age(player) {
  return Number(player.age ?? 0) || 0;
}

function nameOf(player) {
  return player.player_name || player.display_name || player.name || "";
}

function firstStageMissing(id, stages) {
  for (let index = 1; index < stages.length; index += 1) {
    if (stages[index - 1].ids.has(id) && !stages[index].ids.has(id)) return stages[index].name;
  }
  return "present";
}

function matchesRule(player, rule) {
  const value = marketValue(player);
  const playerAge = age(player);
  if (rule.minimum_market_value_eur && value < rule.minimum_market_value_eur) return false;
  if (rule.maximum_age && (!playerAge || playerAge > rule.maximum_age)) return false;
  if (rule.minimum_age && playerAge < rule.minimum_age) return false;
  return true;
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
const stages = stageRows.map(([name, rows]) => ({ name, rows, ids: new Set(rows.map(idOf).filter(Boolean)) }));

const canonicalClubs = (universeValue.clubs || []).filter((club) => Number(club.slot) <= Number(policy.core_playable_world?.top_club_slots ?? 80));
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
    slot: club.slot,
    club_name: club.name,
    transfermarkt_club_id: String(club.transfermarkt_club_id),
    country: club.country || "",
    continent: club.continent || "",
    published_players: players.length,
    rated_players: players.filter((player) => Number(player.tbg_rating) > 0).length,
    youngest_age: players.map(age).filter(Boolean).sort((a, b) => a - b)[0] || null,
    status: players.length >= minimumSquad ? "complete" : players.length ? "thin" : "missing"
  };
});

const wider = rowsFrom(widerValue);
const publishedIds = stages.at(-1).ids;
const externalPriority = wider
  .filter((player) => !publishedIds.has(idOf(player)))
  .map((player) => {
    const matchedRules = (policy.external_priority_rules || []).filter((rule) => matchesRule(player, rule)).map((rule) => rule.name);
    return { ...player, matched_rules: matchedRules };
  })
  .filter((player) => player.matched_rules.length)
  .sort((a, b) => marketValue(b) - marketValue(a) || age(a) - age(b));

const rawRows = stages[0].rows;
const dropouts = rawRows.map((player) => ({
  transfermarkt_player_id: idOf(player),
  player_name: nameOf(player),
  current_club: player.current_club || player.club_name || player.club || "",
  current_club_id: clubIdOf(player),
  age: age(player) || null,
  market_value_eur: marketValue(player),
  first_missing_stage: firstStageMissing(idOf(player), stages)
})).filter((row) => row.transfermarkt_player_id && row.first_missing_stage !== "present");

const report = {
  generated_at: new Date().toISOString(),
  paths,
  stages: stages.map((stage) => ({ name: stage.name, players: stage.rows.length, unique_transfermarkt_ids: stage.ids.size })),
  stage_dropouts: stages.slice(1).map((stage, index) => ({
    from: stages[index].name,
    to: stage.name,
    missing_ids: [...stages[index].ids].filter((id) => !stage.ids.has(id)).length
  })),
  top80_summary: {
    expected_clubs: canonicalClubs.length,
    complete: top80Completeness.filter((club) => club.status === "complete").length,
    thin: top80Completeness.filter((club) => club.status === "thin").length,
    missing: top80Completeness.filter((club) => club.status === "missing").length
  },
  top80_clubs: top80Completeness,
  high_priority_external_missing_count: externalPriority.length,
  high_priority_external_missing: externalPriority,
  dropout_count: dropouts.length,
  dropouts
};

const lines = [
  "# Player Universe Coverage Audit",
  "",
  `Generated: ${report.generated_at}`,
  "",
  "## Pipeline stages",
  ...report.stages.map((stage) => `- ${stage.name}: ${stage.players} rows / ${stage.unique_transfermarkt_ids} unique TM IDs`),
  "",
  "## Top 80 squad completeness",
  `- Complete: ${report.top80_summary.complete}`,
  `- Thin: ${report.top80_summary.thin}`,
  `- Missing: ${report.top80_summary.missing}`,
  "",
  ...top80Completeness.filter((club) => club.status !== "complete").map((club) => `- ${club.slot}. ${club.club_name}: ${club.published_players} players (${club.status})`),
  "",
  "## High-priority external missing players",
  `Count: ${externalPriority.length}`,
  "",
  ...externalPriority.slice(0, 200).map((player) => `- ${player.player_name} (${player.age || "?"}) — ${player.current_club || "Unknown club"} — €${Math.round(marketValue(player) / 1000000)}m — ${player.matched_rules.join(", ")}`),
  "",
  "## Stage dropouts",
  ...report.stage_dropouts.map((item) => `- ${item.from} → ${item.to}: ${item.missing_ids}`)
];

await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
await mkdir(dirname(markdownOutput), { recursive: true });
await writeFile(markdownOutput, lines.join("\n") + "\n", "utf8");
console.log(JSON.stringify({ stages: report.stages, top80_summary: report.top80_summary, high_priority_external_missing_count: externalPriority.length, dropout_count: dropouts.length }, null, 2));
console.log(`Wrote audit JSON: ${output}`);
console.log(`Wrote audit Markdown: ${markdownOutput}`);
