import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiFootballClient } from "../importers/api-football/index.js";

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

async function countEndpoint(label, getter) {
  try {
    const rows = await getter();
    return { label, count: rows.length, ok: rows.length > 0 };
  } catch (error) {
    return { label, count: 0, ok: false, error: error.message };
  }
}

async function main() {
  await loadDotEnv();

  const args = parseArgs(process.argv.slice(2));
  const leagueId = Number(args.league ?? 39);
  const seasons = String(args.seasons ?? "2025,2024,2023,2022,2021")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value));

  const client = new ApiFootballClient();

  console.log(`API-Football coverage diagnostic for league ${leagueId}`);
  console.log("Seasons use starting year, e.g. 2023 means 2023/24.");

  for (const season of seasons) {
    const checks = [];
    checks.push(await countEndpoint("league", () => client.leagues({ leagueId, season })));
    checks.push(await countEndpoint("teams", () => client.teamsByLeagueSeason({ leagueId, season })));
    checks.push(await countEndpoint("fixtures", () => client.fixturesByLeagueSeason({ leagueId, season })));
    checks.push(await countEndpoint("standings", () => client.standingsByLeagueSeason({ leagueId, season })));
    checks.push(await countEndpoint("players-page-1", () => client.playersByLeagueSeason({ leagueId, season, page: 1 })));

    console.log(JSON.stringify({ season, checks }, null, 2));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
