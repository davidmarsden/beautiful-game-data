import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiFootballClient, API_FOOTBALL_CONFIG, normaliseApiFootballPlayers } from "../importers/api-football/index.js";
import { createDataSnapshot } from "../importers/snapshots.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

async function loadDotEnv() {
  try {
    const raw = await readFile(path.join(repoRoot, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsAt = trimmed.indexOf("=");
      if (equalsAt === -1) continue;
      const key = trimmed.slice(0, equalsAt).trim();
      const value = trimmed.slice(equalsAt + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function requireInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Missing or invalid --${name}=number`);
  return parsed;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

function outputFolder({ leagueId, season }) {
  return path.join(repoRoot, "providers", "api-football", String(season), `league-${leagueId}`);
}

async function writeSnapshot(folder, name, snapshot) {
  const outputPath = path.join(folder, `${name}.json`);
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return path.relative(repoRoot, outputPath);
}

function snapshot({ endpoint, rows, leagueId, season, createdAt, normalised = false }) {
  return createDataSnapshot({
    provider: API_FOOTBALL_CONFIG.provider,
    version: API_FOOTBALL_CONFIG.snapshotVersion,
    source: { endpoint, leagueId, season, normalised },
    rows,
    createdAt
  });
}

function assertRows(label, rows, { leagueId, season, required = true }) {
  if (!required || rows.length > 0) return;
  throw new Error(`API-Football returned 0 ${label} for league ${leagueId}, season ${season}.`);
}

async function fetchAllPlayerPages(client, { leagueId, season, maxPages }) {
  const allRows = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const rows = await client.playersByLeagueSeason({ leagueId, season, page });
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < 20) break;
  }
  return allRows;
}

async function safeFetch(label, getter) {
  try {
    const rows = await getter();
    return { label, ok: true, rows };
  } catch (error) {
    console.warn(`${label} failed: ${error.message}`);
    return { label, ok: false, rows: [], error: error.message };
  }
}

async function fetchFixtureDetails(client, fixtures, options) {
  const details = [];
  for (const fixtureRow of fixtures) {
    const fixtureId = fixtureRow.fixture?.id;
    if (!fixtureId) continue;

    const row = { fixtureId };

    if (options.includeLineups) {
      const result = await safeFetch(`fixture ${fixtureId} lineups`, () => client.fixtureLineups({ fixtureId }));
      row.lineups = result.rows;
      if (!result.ok) row.lineupsError = result.error;
    }

    if (options.includeEvents) {
      const result = await safeFetch(`fixture ${fixtureId} events`, () => client.fixtureEvents({ fixtureId }));
      row.events = result.rows;
      if (!result.ok) row.eventsError = result.error;
    }

    if (options.includePlayerStats) {
      const result = await safeFetch(`fixture ${fixtureId} player stats`, () => client.fixturePlayerStatistics({ fixtureId }));
      row.playerStatistics = result.rows;
      if (!result.ok) row.playerStatisticsError = result.error;
    }

    if (options.includeTeamStats) {
      const result = await safeFetch(`fixture ${fixtureId} team stats`, () => client.fixtureTeamStatistics({ fixtureId }));
      row.teamStatistics = result.rows;
      if (!result.ok) row.teamStatisticsError = result.error;
    }

    details.push(row);
  }
  return details;
}

async function fetchTeamDetails(client, teams, options) {
  const coaches = [];
  const transfers = [];

  for (const teamRow of teams) {
    const teamId = teamRow.team?.id;
    if (!teamId) continue;

    if (options.includeCoaches) {
      const result = await safeFetch(`team ${teamId} coaches`, () => client.coachesByTeam({ teamId }));
      coaches.push({ teamId, rows: result.rows, error: result.error ?? null });
    }

    if (options.includeTransfers) {
      const result = await safeFetch(`team ${teamId} transfers`, () => client.transfersByTeam({ teamId }));
      transfers.push({ teamId, rows: result.rows, error: result.error ?? null });
    }
  }

  return { coaches, transfers };
}

async function main() {
  await loadDotEnv();

  const args = parseArgs(process.argv.slice(2));
  const leagueId = requireInteger(args.league, "league");
  const season = requireInteger(args.season, "season");
  const maxPlayerPages = args.maxPlayerPages ? requireInteger(args.maxPlayerPages, "maxPlayerPages") : 100;
  const allowEmpty = parseBoolean(args.allowEmpty);

  const includeLineups = parseBoolean(args.includeLineups, true);
  const includeEvents = parseBoolean(args.includeEvents, true);
  const includePlayerStats = parseBoolean(args.includePlayerStats, true);
  const includeTeamStats = parseBoolean(args.includeTeamStats, true);
  const includeInjuries = parseBoolean(args.includeInjuries, true);
  const includeCoaches = parseBoolean(args.includeCoaches, true);
  const includeTransfers = parseBoolean(args.includeTransfers, true);

  const client = new ApiFootballClient({
    requestDelayMs: args.requestDelayMs ? Number(args.requestDelayMs) : undefined
  });

  const createdAt = new Date().toISOString();
  const folder = outputFolder({ leagueId, season });
  await mkdir(folder, { recursive: true });

  const leagueRows = await client.leagues({ leagueId, season });
  assertRows("league metadata rows", leagueRows, { leagueId, season, required: !allowEmpty });

  const teams = await client.teamsByLeagueSeason({ leagueId, season });
  assertRows("teams", teams, { leagueId, season, required: !allowEmpty });

  const fixtures = await client.fixturesByLeagueSeason({ leagueId, season });
  assertRows("fixtures", fixtures, { leagueId, season, required: !allowEmpty });

  const standings = await client.standingsByLeagueSeason({ leagueId, season });
  assertRows("standings", standings, { leagueId, season, required: !allowEmpty });

  const playerRows = await fetchAllPlayerPages(client, { leagueId, season, maxPages: maxPlayerPages });
  assertRows("players", playerRows, { leagueId, season, required: !allowEmpty });
  const players = normaliseApiFootballPlayers(playerRows, { importedAt: createdAt });

  const fixtureDetails = await fetchFixtureDetails(client, fixtures, {
    includeLineups,
    includeEvents,
    includePlayerStats,
    includeTeamStats
  });

  const teamDetails = await fetchTeamDetails(client, teams, {
    includeCoaches,
    includeTransfers
  });

  let injuries = [];
  if (includeInjuries) {
    const result = await safeFetch("league injuries", () => client.injuriesByLeagueSeason({ leagueId, season }));
    injuries = result.rows;
  }

  const files = [];
  files.push(await writeSnapshot(folder, "league", snapshot({ endpoint: "leagues", rows: leagueRows, leagueId, season, createdAt })));
  files.push(await writeSnapshot(folder, "teams", snapshot({ endpoint: "teams", rows: teams, leagueId, season, createdAt })));
  files.push(await writeSnapshot(folder, "fixtures", snapshot({ endpoint: "fixtures", rows: fixtures, leagueId, season, createdAt })));
  files.push(await writeSnapshot(folder, "standings", snapshot({ endpoint: "standings", rows: standings, leagueId, season, createdAt })));
  files.push(await writeSnapshot(folder, "players", snapshot({ endpoint: "players", rows: players, leagueId, season, createdAt, normalised: true })));
  files.push(await writeSnapshot(folder, "fixture-details", snapshot({ endpoint: "fixture-details", rows: fixtureDetails, leagueId, season, createdAt })));
  files.push(await writeSnapshot(folder, "coaches", snapshot({ endpoint: "coachs", rows: teamDetails.coaches, leagueId, season, createdAt })));
  files.push(await writeSnapshot(folder, "transfers", snapshot({ endpoint: "transfers", rows: teamDetails.transfers, leagueId, season, createdAt })));
  files.push(await writeSnapshot(folder, "injuries", snapshot({ endpoint: "injuries", rows: injuries, leagueId, season, createdAt })));

  const manifest = {
    provider: API_FOOTBALL_CONFIG.provider,
    version: "pro-league-harvest-v0.1",
    leagueId,
    season,
    createdAt,
    options: {
      maxPlayerPages,
      includeLineups,
      includeEvents,
      includePlayerStats,
      includeTeamStats,
      includeInjuries,
      includeCoaches,
      includeTransfers
    },
    counts: {
      leagueRows: leagueRows.length,
      teams: teams.length,
      fixtures: fixtures.length,
      standings: standings.length,
      playerRows: playerRows.length,
      players: players.length,
      fixtureDetails: fixtureDetails.length,
      coachTeams: teamDetails.coaches.length,
      transferTeams: teamDetails.transfers.length,
      injuries: injuries.length
    },
    files
  };

  await writeFile(path.join(folder, "pro-harvest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Pro harvest completed for league ${leagueId}, season ${season}.`);
  console.log(JSON.stringify(manifest.counts, null, 2));
  console.log(`Wrote ${path.relative(repoRoot, folder)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
