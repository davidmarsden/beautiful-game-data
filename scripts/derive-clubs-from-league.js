import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDerivedClubs } from "../derived/clubs/index.js";
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

function requireArg(args, name) {
  if (!args[name]) throw new Error(`Missing --${name}`);
  return args[name];
}

function repoPath(value) {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

async function latestDerivedPlayersPath() {
  const folder = path.join(repoRoot, "derived", "players");
  const files = await readdir(folder);
  const snapshots = files.filter((file) => file.endsWith(".json")).sort();
  if (!snapshots.length) throw new Error("No derived player snapshots found.");
  return path.join(folder, snapshots.at(-1));
}

function standingRows(standingsSnapshot) {
  const first = standingsSnapshot.rows?.[0];
  return first?.league?.standings?.[0] ?? [];
}

function coachRowsForTeam(coachesSnapshot, teamId) {
  const teamCoaches = coachesSnapshot.rows?.find((row) => String(row.teamId) === String(teamId));
  return teamCoaches?.rows ?? [];
}

async function readSnapshot(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const season = requireArg(args, "season");
  const league = requireArg(args, "league");
  const leagueFolder = repoPath(args.leagueFolder ?? `providers/api-football/${season}/league-${league}`);
  const derivedPlayersPath = args.players ? repoPath(args.players) : await latestDerivedPlayersPath();

  const teamsSnapshot = await readSnapshot(path.join(leagueFolder, "teams.json"));
  const standingsSnapshot = await readSnapshot(path.join(leagueFolder, "standings.json"));
  const coachesSnapshot = await readSnapshot(path.join(leagueFolder, "coaches.json"));
  const playersSnapshot = await readSnapshot(derivedPlayersPath);

  const standings = standingRows(standingsSnapshot);
  const teamCount = teamsSnapshot.rows.length;

  const clubs = buildDerivedClubs(teamsSnapshot.rows.map((teamRow) => {
    const providerTeamId = String(teamRow.team?.id);
    const players = playersSnapshot.rows.filter((player) => String(player.team?.providerTeamId) === providerTeamId);
    const standing = standings.find((row) => String(row.team?.id) === providerTeamId) ?? null;

    return {
      team: teamRow,
      players,
      standing,
      coachRows: coachRowsForTeam(coachesSnapshot, providerTeamId),
      teamCount
    };
  }));

  const snapshot = createDataSnapshot({
    provider: "beautiful-game-data",
    version: "derived-clubs-v0.1",
    source: {
      league,
      season,
      leagueFolder: path.relative(repoRoot, leagueFolder),
      players: path.relative(repoRoot, derivedPlayersPath)
    },
    rows: clubs
  });

  const outputFolder = path.join(repoRoot, "derived", "clubs");
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const outputPath = path.join(outputFolder, `clubs-league-${league}-season-${season}-${stamp}.json`);

  await mkdir(outputFolder, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  console.log(`Derived ${clubs.length} clubs.`);
  console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
