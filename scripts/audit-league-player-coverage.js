import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function parseArgs(argv) {
  return Object.fromEntries(argv.map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

function rowsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.players)) return value.players;
  return [];
}

function num(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function text(value) { return String(value ?? "").trim(); }
function tmId(player) { return text(player.transfermarkt_player_id || player.transfermarkt_id || player.transfermarktId || player.player_id || player.id); }
function leagueCode(player) { return text(player.current_competition_code || player.competition_code || player.league_code); }
function leagueName(player) { return text(player.current_competition || player.competition_name || player.league || player.current_league); }
function clubName(player) { return text(player.current_club || player.club_name || player.club); }
function rating(player) { return num(player.tbg_rating ?? player.underlying_ability_rating); }
function marketValue(player) { return num(player.market_value_eur ?? player.market_value); }
function age(player) { return num(player.age); }

function matchesLeague(player, league) {
  const code = leagueCode(player).toLowerCase();
  const name = leagueName(player).toLowerCase();
  return (league.competition_codes || []).some((item) => text(item).toLowerCase() === code)
    || (league.name_aliases || []).some((item) => text(item).toLowerCase() === name);
}

const args = parseArgs(process.argv.slice(2));
const masterPath = args.master ?? "data/transfermarkt/players-master.json";
const publishedPath = args.published ?? "derived/player-database/player-database.json";
const benchmarksPath = args.benchmarks ?? "data/config/league-coverage-benchmarks.json";
const outputPath = args.output ?? "derived/player-universe/league-player-coverage-audit.json";
const markdownPath = args.markdown ?? "derived/player-universe/league-player-coverage-audit.md";

const [masterValue, publishedValue, benchmarks] = await Promise.all([
  readJson(masterPath, []), readJson(publishedPath, []), readJson(benchmarksPath, { leagues: [] })
]);
const master = rowsFrom(masterValue);
const published = rowsFrom(publishedValue);
const publishedIds = new Set(published.map(tmId).filter(Boolean));

const leagues = (benchmarks.leagues || []).map((league) => {
  const imported = master.filter((player) => matchesLeague(player, league));
  const live = imported.filter((player) => publishedIds.has(tmId(player)));
  const expected = num(league.expected_players);
  const importedCount = imported.length;
  const publishedCount = live.length;
  const missingEstimate = Math.max(0, expected - importedCount);
  return {
    key: league.key,
    league: league.name,
    country: league.country,
    expected_players: expected,
    imported_players: importedCount,
    published_players: publishedCount,
    estimated_not_imported: missingEstimate,
    imported_coverage_pct: expected ? Number((importedCount / expected * 100).toFixed(1)) : null,
    published_coverage_pct: expected ? Number((publishedCount / expected * 100).toFixed(1)) : null,
    clubs_represented: new Set(imported.map(clubName).filter(Boolean)).size,
    under_21: imported.filter((player) => age(player) > 0 && age(player) <= 21).length,
    under_23: imported.filter((player) => age(player) > 0 && age(player) <= 23).length,
    value_1m_plus: imported.filter((player) => marketValue(player) >= 1_000_000).length,
    value_5m_plus: imported.filter((player) => marketValue(player) >= 5_000_000).length,
    value_20m_plus: imported.filter((player) => marketValue(player) >= 20_000_000).length,
    rated_84_plus: live.filter((player) => rating(player) >= 84).length,
    rated_87_plus: live.filter((player) => rating(player) >= 87).length,
    rated_90_plus: live.filter((player) => rating(player) >= 90).length,
    total_market_value_eur: imported.reduce((sum, player) => sum + marketValue(player), 0),
    status: importedCount >= expected * 0.95 ? "strong" : importedCount >= expected * 0.8 ? "partial" : "under-covered"
  };
}).sort((a, b) => a.imported_coverage_pct - b.imported_coverage_pct);

const totals = leagues.reduce((memo, league) => {
  memo.expected_players += league.expected_players;
  memo.imported_players += league.imported_players;
  memo.published_players += league.published_players;
  memo.estimated_not_imported += league.estimated_not_imported;
  return memo;
}, { expected_players: 0, imported_players: 0, published_players: 0, estimated_not_imported: 0 });
totals.imported_coverage_pct = totals.expected_players ? Number((totals.imported_players / totals.expected_players * 100).toFixed(1)) : null;
totals.published_coverage_pct = totals.expected_players ? Number((totals.published_players / totals.expected_players * 100).toFixed(1)) : null;

const report = { generated_at: new Date().toISOString(), benchmarks_version: benchmarks.version || "", totals, leagues };
const markdown = [
  "# League Player Coverage Audit", "", `Generated: ${report.generated_at}`, "",
  `Big Five expected: ${totals.expected_players}`,
  `Imported: ${totals.imported_players} (${totals.imported_coverage_pct}%)`,
  `Published: ${totals.published_players} (${totals.published_coverage_pct}%)`,
  `Estimated not imported: ${totals.estimated_not_imported}`, "", "## Leagues", "",
  ...leagues.map((league) => `- ${league.league}: ${league.imported_players}/${league.expected_players} imported (${league.imported_coverage_pct}%), ${league.published_players} published, ${league.clubs_represented} clubs, ${league.estimated_not_imported} estimated missing — ${league.status}`)
];

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
await mkdir(dirname(markdownPath), { recursive: true });
await writeFile(markdownPath, markdown.join("\n") + "\n", "utf8");
console.log(JSON.stringify({ totals, leagues: leagues.map(({ league, imported_players, expected_players, imported_coverage_pct, status }) => ({ league, imported_players, expected_players, imported_coverage_pct, status })) }, null, 2));
console.log(`Wrote league coverage audit: ${outputPath}`);
