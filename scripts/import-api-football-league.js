import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiFootballClient, API_FOOTBALL_CONFIG, normaliseApiFootballPlayers } from "../importers/api-football/index.js";
import { createDataSnapshot } from "../importers/snapshots.js";

const FREE_PLAN_MAX_PLAYER_PAGES = 3;
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

function outputFolder({ leagueId, season }) {
  return path.join(repoRoot, "providers", "api-football", String(season), `league-${leagueId}`);
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

  throw new Error([
    `API-Football returned 0 ${label} for league ${leagueId}, season ${season}.`,
    "Import aborted so empty data cannot flow into derived ratings or the engine.",
    "Possible causes:",
    "- this season is not available on your API-Football plan",
    "- API-Football seasons use the starting year, e.g. 2023 for 2023/24",
    "- wrong league id or season",
    "- quota/rate limit/account coverage issue",
    "Try running the diagnostic workflow, or try league=39 season=2023."
  ].join("\n"));
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

async function main() {
  await loadDotEnv();

  const args = parseArgs(process.argv.slice(2));
  const leagueId = requireInteger(args.league, "league");
  const season = requireInteger(args.season, "season");
  const requestedMaxPages = args.maxPages ? requireInteger(args.maxPages, "maxPages") : 1;
  const maxPages = Math.min(requestedMaxPages, FREE_PLAN_MAX_PLAYER_PAGES);
  const allowEmpty = parseBoolean(args.allowEmpty);
  const includeCoaches = parseBoolean(args.includeCoaches, false);

  if (requestedMaxPages > FREE_PLAN_MAX_PLAYER_PAGES) {
    console.warn(`Free API-Football plans only allow player pages up to ${FREE_PLAN_MAX_PLAYER_PAGES}. Using maxPages=${maxPages}.`);
  }

  const client = new ApiFootballClient();
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

  const playerRows = await fetchAllPlayerPages(client, { leagueId, season, maxPages });
  assertRows("players", playerRows, { leagueId, season, required: !allowEmpty });

  const players = normaliseApiFootballPlayers(playerRows, { importedAt: createdAt });

  const coaches = [];
  if (includeCoaches) {
    for (const teamRow of teams) {
      const teamId = teamRow.team?.id;
      if (!teamId) continue;
      const teamCoaches = await client.coachesByTeam({ teamId });
      coaches.push({ teamId, rows: teamCoaches });
    }
  }

  const files = [];
  files.push(await writeSnapshot(folder, "league", snapshot({ endpoint: "leagues", rows: leagueRows, leagueId, season, createdAt })));
  files.push(await writeSnapshot(folder, "teams", snapshot({ endpoint: "teams", rows: teams, leagueId, season, createdAt })));
  files.push(await writeSnapshot(folder, "fixtures", snapshot({ endpoint: "fixtures", rows: fixtures, leagueId, season, createdAt })));
  files.push(await writeSnapshot(folder, "standings", snapshot({ endpoint: "standings", rows: standings, leagueId, season, createdAt })));
  files.push(await writeSnapshot(folder, "coaches", snapshot({ endpoint: "coachs", rows: coaches, leagueId, season, createdAt })));
  files.push(await writeSnapshot(folder, "players", snapshot({ endpoint: "players", rows: players, leagueId, season, createdAt, normalised: true })));

  const manifest = {
    provider: API_FOOTBALL_CONFIG.provider,
    version: "complete-league-snapshot-v0.3",
    leagueId,
    season,
    createdAt,
    requestedMaxPages,
    maxPages,
    includeCoaches,
    counts: {
      leagueRows: leagueRows.length,
      teams: teams.length,
      fixtures: fixtures.length,
      standings: standings.length,
      playerRows: playerRows.length,
      players: players.length,
      coachTeams: coaches.length
    },
    files
  };

  const manifestPath = path.join(folder, "snapshot.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Imported complete league snapshot for league ${leagueId}, season ${season}.`);
  console.log(JSON.stringify(manifest.counts, null, 2));
  console.log(`Wrote ${path.relative(repoRoot, folder)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
