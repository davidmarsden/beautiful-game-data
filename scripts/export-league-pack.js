import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLeaguePack } from "../exports/league-packs/index.js";

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

function requireArg(args, name) {
  if (!args[name]) throw new Error(`Missing --${name}`);
  return args[name];
}

function repoPath(value) {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function snapshotMatchesLeagueSeason(snapshot, { league, season }) {
  const source = snapshot.meta?.source ?? {};
  const input = String(source.input ?? source.players ?? source.leagueFolder ?? "");
  return (
    String(source.league) === String(league) && String(source.season) === String(season)
  ) || input.includes(`providers/api-football/${season}/league-${league}`);
}

async function latestMatchingJson(folder, { league, season, label }) {
  const files = (await readdir(folder)).filter((file) => file.endsWith(".json")).sort();
  const matches = [];

  for (const file of files) {
    const filePath = path.join(folder, file);
    const snapshot = await readJson(filePath);
    if (snapshotMatchesLeagueSeason(snapshot, { league, season })) matches.push(filePath);
  }

  if (!matches.length) {
    throw new Error(`No ${label} snapshot found for league ${league}, season ${season}.`);
  }

  return matches.at(-1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const league = requireArg(args, "league");
  const season = requireArg(args, "season");

  const leagueFolder = repoPath(args.leagueFolder ?? `providers/api-football/${season}/league-${league}`);
  const playersPath = args.players
    ? repoPath(args.players)
    : await latestMatchingJson(path.join(repoRoot, "derived", "players"), { league, season, label: "derived players" });
  const clubsPath = args.clubs
    ? repoPath(args.clubs)
    : await latestMatchingJson(path.join(repoRoot, "derived", "clubs"), { league, season, label: "derived clubs" });

  const playersSnapshot = await readJson(playersPath);
  const clubsSnapshot = await readJson(clubsPath);
  const fixturesSnapshot = await readJson(path.join(leagueFolder, "fixtures.json"));
  const standingsSnapshot = await readJson(path.join(leagueFolder, "standings.json"));

  const pack = buildLeaguePack({
    clubs: clubsSnapshot.rows,
    players: playersSnapshot.rows,
    fixtures: fixturesSnapshot.rows,
    standingsSnapshot,
    source: {
      league,
      season,
      leagueFolder: path.relative(repoRoot, leagueFolder),
      players: path.relative(repoRoot, playersPath),
      clubs: path.relative(repoRoot, clubsPath),
      fixtures: path.relative(repoRoot, path.join(leagueFolder, "fixtures.json")),
      standings: path.relative(repoRoot, path.join(leagueFolder, "standings.json"))
    }
  });

  const outputFolder = path.join(repoRoot, "exports", "league-packs");
  const outputPath = path.join(outputFolder, `league-${league}-season-${season}.json`);
  await mkdir(outputFolder, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");

  console.log(`Exported league pack.`);
  console.log(`Using players ${path.relative(repoRoot, playersPath)}`);
  console.log(`Using clubs ${path.relative(repoRoot, clubsPath)}`);
  console.log(JSON.stringify(pack.meta.counts, null, 2));
  console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
