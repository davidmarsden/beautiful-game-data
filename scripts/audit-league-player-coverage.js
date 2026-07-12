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
function clubId(player) { return text(player.current_club_id || player.transfermarkt_club_id || player.club_id || player.real_club_source_id); }
function rating(player) { return num(player.tbg_rating ?? player.underlying_ability_rating ?? player.effective_match_rating); }
function marketValue(player) { return num(player.market_value_eur ?? player.market_value); }
function age(player) { return num(player.age); }

function normalise(value) {
  return text(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function metadataClaimsLeague(player, league) {
  const code = normalise(leagueCode(player));
  const name = normalise(leagueName(player));
  return (league.competition_codes || []).some((item) => normalise(item) === code)
    || (league.name_aliases || []).some((item) => normalise(item) === name);
}

function canonicalMatcher(league) {
  const byId = new Map();
  const byName = new Map();
  for (const club of league.canonical_clubs || []) {
    if (text(club.id)) byId.set(text(club.id), club);
    for (const value of [club.name, ...(club.aliases || [])]) {
      const key = normalise(value);
      if (key) byName.set(key, club);
    }
  }
  return {
    clubs: league.canonical_clubs || [],
    match(player) {
      return byId.get(clubId(player)) || byName.get(normalise(clubName(player))) || null;
    }
  };
}

function playerSummary(player) {
  return {
    transfermarkt_player_id: tmId(player),
    player_name: player.player_name || player.display_name || player.name || "",
    current_club_id: clubId(player),
    current_club: clubName(player),
    competition_code: leagueCode(player),
    competition_name: leagueName(player),
    age: age(player) || null,
    market_value_eur: marketValue(player),
    tbg_rating: rating(player) || null
  };
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
  const matcher = canonicalMatcher(league);
  const canonicalImported = master.filter((player) => matcher.match(player));
  const canonicalPublished = canonicalImported.map((player) => publishedById.get(tmId(player))).filter(Boolean);
  const metadataImported = master.filter((player) => metadataClaimsLeague(player, league));
  const metadataFalsePositives = metadataImported.filter((player) => !matcher.match(player));
  const metadataFalseNegatives = canonicalImported.filter((player) => !metadataClaimsLeague(player, league));
  const expected = num(league.expected_players);

  const clubReports = matcher.clubs.map((club) => {
    const imported = canonicalImported.filter((player) => matcher.match(player) === club);
    const live = imported.map((player) => publishedById.get(tmId(player))).filter(Boolean);
    return {
      club_id: text(club.id),
      club_name: club.name,
      imported_players: imported.length,
      published_players: live.length,
      excluded_from_publication: imported.length - live.length,
      metadata_mismatch_players: imported.filter((player) => !metadataClaimsLeague(player, league)).length,
      youngest_age: imported.map(age).filter(Boolean).sort((a, b) => a - b)[0] || null,
      total_market_value_eur: imported.reduce((sum, player) => sum + marketValue(player), 0),
      status: imported.length >= 18 ? "complete" : imported.length ? "thin" : "missing"
    };
  }).sort((a, b) => a.imported_players - b.imported_players || a.club_name.localeCompare(b.club_name));

  const importedCount = canonicalImported.length;
  const publishedCount = canonicalPublished.length;
  const coverage = expected ? importedCount / expected : 0;
  const missingClubs = clubReports.filter((club) => club.status === "missing");
  const thinClubs = clubReports.filter((club) => club.status === "thin");

  return {
    key: league.key,
    league: league.name,
    country: league.country,
    season: benchmarks.season || "",
    expected_players: expected,
    expected_clubs: matcher.clubs.length,
    imported_players: importedCount,
    published_players: publishedCount,
    estimated_not_imported: Math.max(0, expected - importedCount),
    imported_coverage_pct: expected ? Number((coverage * 100).toFixed(1)) : null,
    published_coverage_pct: expected ? Number((publishedCount / expected * 100).toFixed(1)) : null,
    clubs_complete: clubReports.filter((club) => club.status === "complete").length,
    clubs_thin: thinClubs.length,
    clubs_missing: missingClubs.length,
    club_reports: clubReports,
    under_21: canonicalImported.filter((player) => age(player) > 0 && age(player) <= 21).length,
    under_23: canonicalImported.filter((player) => age(player) > 0 && age(player) <= 23).length,
    value_1m_plus: canonicalImported.filter((player) => marketValue(player) >= 1_000_000).length,
    value_5m_plus: canonicalImported.filter((player) => marketValue(player) >= 5_000_000).length,
    value_20m_plus: canonicalImported.filter((player) => marketValue(player) >= 20_000_000).length,
    rated_84_plus: canonicalPublished.filter((player) => rating(player) >= 84).length,
    rated_87_plus: canonicalPublished.filter((player) => rating(player) >= 87).length,
    rated_90_plus: canonicalPublished.filter((player) => rating(player) >= 90).length,
    total_market_value_eur: canonicalImported.reduce((sum, player) => sum + marketValue(player), 0),
    metadata_false_positive_count: metadataFalsePositives.length,
    metadata_false_negative_count: metadataFalseNegatives.length,
    metadata_false_positives: metadataFalsePositives.map(playerSummary),
    metadata_false_negatives: metadataFalseNegatives.map(playerSummary),
    imported_but_not_published: canonicalImported.filter((player) => !publishedById.has(tmId(player))).map(playerSummary),
    status: missingClubs.length ? "missing-clubs" : thinClubs.length ? "thin-clubs" : coverage >= 0.95 ? "strong" : coverage >= 0.8 ? "partial" : "under-covered"
  };
}).sort((a, b) => a.imported_coverage_pct - b.imported_coverage_pct);

const totals = leagues.reduce((memo, league) => {
  memo.expected_players += league.expected_players;
  memo.imported_players += league.imported_players;
  memo.published_players += league.published_players;
  memo.estimated_not_imported += league.estimated_not_imported;
  memo.clubs_complete += league.clubs_complete;
  memo.clubs_thin += league.clubs_thin;
  memo.clubs_missing += league.clubs_missing;
  memo.metadata_false_positive_count += league.metadata_false_positive_count;
  memo.metadata_false_negative_count += league.metadata_false_negative_count;
  return memo;
}, { expected_players: 0, imported_players: 0, published_players: 0, estimated_not_imported: 0, clubs_complete: 0, clubs_thin: 0, clubs_missing: 0, metadata_false_positive_count: 0, metadata_false_negative_count: 0 });
totals.imported_coverage_pct = totals.expected_players ? Number((totals.imported_players / totals.expected_players * 100).toFixed(1)) : null;
totals.published_coverage_pct = totals.expected_players ? Number((totals.published_players / totals.expected_players * 100).toFixed(1)) : null;

const report = { generated_at: new Date().toISOString(), benchmarks_version: benchmarks.version || "", season: benchmarks.season || "", methodology: "canonical_club_membership", totals, leagues };
const markdown = [
  "# Canonical League Player Coverage Audit", "", `Generated: ${report.generated_at}`, `Season: ${report.season}`, "",
  `Big Five expected: ${totals.expected_players}`,
  `Imported: ${totals.imported_players} (${totals.imported_coverage_pct}%)`,
  `Published: ${totals.published_players} (${totals.published_coverage_pct}%)`,
  `Clubs: ${totals.clubs_complete} complete, ${totals.clubs_thin} thin, ${totals.clubs_missing} missing`,
  `Metadata errors: ${totals.metadata_false_positive_count} false positives, ${totals.metadata_false_negative_count} false negatives`, "", "## Leagues", "",
  ...leagues.flatMap((league) => [
    `### ${league.league}`,
    `- Players: ${league.imported_players}/${league.expected_players} imported (${league.imported_coverage_pct}%), ${league.published_players} published`,
    `- Clubs: ${league.clubs_complete} complete, ${league.clubs_thin} thin, ${league.clubs_missing} missing`,
    `- Ratings: ${league.rated_84_plus} rated 84+, ${league.rated_87_plus} rated 87+, ${league.rated_90_plus} rated 90+`,
    `- Metadata: ${league.metadata_false_positive_count} players wrongly labelled as league members; ${league.metadata_false_negative_count} canonical players carrying other/stale league metadata`,
    `- Status: ${league.status}`,
    `- Club coverage: ${league.club_reports.map((club) => `${club.club_name} ${club.imported_players}/${club.published_players} (${club.status})`).join(", ")}`,
    ...(league.metadata_false_positives.length ? [`- Wrongly tagged clubs: ${[...new Set(league.metadata_false_positives.map((player) => player.current_club).filter(Boolean))].join(", ")}`] : []),
    ""
  ])
];

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
await mkdir(dirname(markdownPath), { recursive: true });
await writeFile(markdownPath, markdown.join("\n") + "\n", "utf8");
console.log(JSON.stringify({ methodology: report.methodology, season: report.season, totals, leagues: leagues.map(({ league, imported_players, expected_players, imported_coverage_pct, clubs_complete, clubs_thin, clubs_missing, metadata_false_positive_count, metadata_false_negative_count, status }) => ({ league, imported_players, expected_players, imported_coverage_pct, clubs_complete, clubs_thin, clubs_missing, metadata_false_positive_count, metadata_false_negative_count, status })) }, null, 2));
console.log(`Wrote canonical league coverage audit: ${outputPath}`);
