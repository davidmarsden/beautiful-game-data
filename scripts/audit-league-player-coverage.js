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
function clubId(player) { return text(player.current_club_id || player.transfermarkt_club_id || player.club_id); }
function rating(player) { return num(player.tbg_rating ?? player.underlying_ability_rating ?? player.effective_match_rating); }
function marketValue(player) { return num(player.market_value_eur ?? player.market_value); }
function age(player) { return num(player.age); }

function normalise(value) {
  return text(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesLeague(player, league) {
  const code = normalise(leagueCode(player));
  const name = normalise(leagueName(player));
  return (league.competition_codes || []).some((item) => normalise(item) === code)
    || (league.name_aliases || []).some((item) => normalise(item) === name);
}

function clubKey(player) {
  return clubId(player) || normalise(clubName(player));
}

function clubBreakdown(players) {
  const byClub = new Map();
  for (const player of players) {
    const key = clubKey(player);
    if (!key) continue;
    const current = byClub.get(key) || { club_id: clubId(player), club_name: clubName(player), players: 0 };
    current.players += 1;
    if (!current.club_name && clubName(player)) current.club_name = clubName(player);
    byClub.set(key, current);
  }
  return [...byClub.values()].sort((a, b) => b.players - a.players || a.club_name.localeCompare(b.club_name));
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
const publishedById = new Map(published.map((player) => [tmId(player), player]).filter(([id]) => id));

const leagues = (benchmarks.leagues || []).map((league) => {
  const imported = master.filter((player) => matchesLeague(player, league));
  const live = imported.map((player) => publishedById.get(tmId(player))).filter(Boolean);
  const expected = num(league.expected_players);
  const expectedClubs = num(league.expected_clubs);
  const importedClubs = clubBreakdown(imported);
  const publishedClubs = clubBreakdown(live);
  const importedCount = imported.length;
  const publishedCount = live.length;
  const missingEstimate = Math.max(0, expected - importedCount);
  const clubGap = expectedClubs ? Math.max(0, expectedClubs - importedClubs.length) : null;
  const coverage = expected ? importedCount / expected : 0;
  return {
    key: league.key,
    league: league.name,
    country: league.country,
    expected_players: expected,
    expected_clubs: expectedClubs || null,
    imported_players: importedCount,
    published_players: publishedCount,
    estimated_not_imported: missingEstimate,
    imported_coverage_pct: expected ? Number((coverage * 100).toFixed(1)) : null,
    published_coverage_pct: expected ? Number((publishedCount / expected * 100).toFixed(1)) : null,
    clubs_represented: importedClubs.length,
    published_clubs_represented: publishedClubs.length,
    estimated_clubs_not_represented: clubGap,
    club_breakdown: importedClubs,
    under_21: imported.filter((player) => age(player) > 0 && age(player) <= 21).length,
    under_23: imported.filter((player) => age(player) > 0 && age(player) <= 23).length,
    value_1m_plus: imported.filter((player) => marketValue(player) >= 1_000_000).length,
    value_5m_plus: imported.filter((player) => marketValue(player) >= 5_000_000).length,
    value_20m_plus: imported.filter((player) => marketValue(player) >= 20_000_000).length,
    rated_84_plus: live.filter((player) => rating(player) >= 84).length,
    rated_87_plus: live.filter((player) => rating(player) >= 87).length,
    rated_90_plus: live.filter((player) => rating(player) >= 90).length,
    total_market_value_eur: imported.reduce((sum, player) => sum + marketValue(player), 0),
    anomalies: [
      importedClubs.length > expectedClubs && expectedClubs ? `${importedClubs.length - expectedClubs} extra club identities; inspect aliases or promoted/relegated records` : null,
      clubGap ? `${clubGap} expected club${clubGap === 1 ? "" : "s"} not represented` : null,
      publishedCount < importedCount ? `${importedCount - publishedCount} imported player${importedCount - publishedCount === 1 ? "" : "s"} excluded from publication` : null
    ].filter(Boolean),
    status: coverage >= 0.95 ? "strong" : coverage >= 0.8 ? "partial" : "under-covered"
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
  ...leagues.flatMap((league) => [
    `### ${league.league}`,
    `- Players: ${league.imported_players}/${league.expected_players} imported (${league.imported_coverage_pct}%), ${league.published_players} published`,
    `- Clubs: ${league.clubs_represented}${league.expected_clubs ? `/${league.expected_clubs}` : ""} represented`,
    `- Ratings: ${league.rated_84_plus} rated 84+, ${league.rated_87_plus} rated 87+, ${league.rated_90_plus} rated 90+`,
    `- Young players: ${league.under_21} U21, ${league.under_23} U23`,
    `- Status: ${league.status}`,
    ...(league.anomalies.length ? league.anomalies.map((item) => `- Audit flag: ${item}`) : []),
    `- Club counts: ${league.club_breakdown.map((club) => `${club.club_name || club.club_id} (${club.players})`).join(", ")}`,
    ""
  ])
];

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
await mkdir(dirname(markdownPath), { recursive: true });
await writeFile(markdownPath, markdown.join("\n") + "\n", "utf8");
console.log(JSON.stringify({ totals, leagues: leagues.map(({ league, imported_players, expected_players, imported_coverage_pct, clubs_represented, rated_84_plus, status, anomalies }) => ({ league, imported_players, expected_players, imported_coverage_pct, clubs_represented, rated_84_plus, status, anomalies })) }, null, 2));
console.log(`Wrote league coverage audit: ${outputPath}`);
