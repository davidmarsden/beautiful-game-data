import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ApiFootballClient,
  API_FOOTBALL_CONFIG,
  normaliseApiFootballPlayers
} from "../importers/api-football/index.js";
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
  if (!Number.isInteger(parsed)) {
    throw new Error(`Missing or invalid --${name}=number`);
  }
  return parsed;
}

function buildOutputPath({ leagueId, season }) {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return path.join(
    repoRoot,
    "providers",
    "api-football",
    String(season),
    `league-${leagueId}`,
    `players-${stamp}.json`
  );
}

async function fetchAllPlayerPages(client, { leagueId, season, maxPages }) {
  const allRows = [];
  let page = 1;

  while (page <= maxPages) {
    const rows = await client.playersByLeagueSeason({ leagueId, season, page });
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < 20) break;
    page += 1;
  }

  return allRows;
}

async function main() {
  await loadDotEnv();

  const args = parseArgs(process.argv.slice(2));
  const leagueId = requireInteger(args.league, "league");
  const season = requireInteger(args.season, "season");
  const maxPages = args.maxPages ? requireInteger(args.maxPages, "maxPages") : 1;

  const client = new ApiFootballClient();
  const importedAt = new Date().toISOString();
  const apiRows = await fetchAllPlayerPages(client, { leagueId, season, maxPages });
  const rows = normaliseApiFootballPlayers(apiRows, { importedAt });
  const snapshot = createDataSnapshot({
    provider: API_FOOTBALL_CONFIG.provider,
    version: API_FOOTBALL_CONFIG.snapshotVersion,
    source: { leagueId, season, maxPages, endpoint: "players" },
    rows,
    createdAt: importedAt
  });

  const outputPath = buildOutputPath({ leagueId, season });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  console.log(`Imported ${rows.length} players.`);
  console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
