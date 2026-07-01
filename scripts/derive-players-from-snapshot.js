import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDerivedPlayers } from "../derived/players/index.js";
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

function inputPathFromArg(value) {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

function outputPathFromInput(inputPath) {
  const parsed = path.parse(inputPath);
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return path.join(repoRoot, "derived", "players", `${parsed.name}-derived-${stamp}.json`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = inputPathFromArg(requireArg(args, "snapshot"));
  const leagueTier = args.leagueTier ?? "S";
  const outputPath = args.output ? inputPathFromArg(args.output) : outputPathFromInput(inputPath);

  const raw = await readFile(inputPath, "utf8");
  const snapshot = JSON.parse(raw);
  const rows = snapshot.rows ?? [];

  if (!Array.isArray(rows)) {
    throw new Error("Snapshot rows must be an array.");
  }

  const derivedRows = buildDerivedPlayers(rows.map((player) => ({ player, leagueTier })));
  const derivedSnapshot = createDataSnapshot({
    provider: "beautiful-game-data",
    version: "derived-players-v0.1",
    source: {
      input: path.relative(repoRoot, inputPath),
      sourceProvider: snapshot.meta?.provider ?? null,
      sourceVersion: snapshot.meta?.version ?? null,
      leagueTier
    },
    rows: derivedRows
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(derivedSnapshot, null, 2)}\n`, "utf8");

  console.log(`Derived ${derivedRows.length} players.`);
  console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
