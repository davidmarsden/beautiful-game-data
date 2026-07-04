import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createPlayerIdentityResolver } from "../src/identity/playerIdentityResolver.js";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

async function loadRows(path) {
  const text = await readFile(path, "utf8");
  return path.endsWith(".json") ? JSON.parse(text) : parseCsv(text);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[,"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(rows) {
  const headers = [
    "input_name",
    "matched",
    "ambiguous",
    "confidence",
    "method",
    "tbg_player_id",
    "transfermarkt_id",
    "canonical_name",
    "current_club",
    "position",
    "date_of_birth",
    "candidate_count",
    "reasons"
  ];
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n";
}

function queryFromRow(row) {
  return {
    ...row,
    name: row.name || row.player_name || row.playerName || row.display_name || row.full_name || "",
    date_of_birth: row.date_of_birth || row.dob || row.birth_date || "",
    transfermarkt_id: row.transfermarkt_id || row.player_id || row.tm_id || "",
    soccerwiki_id: row.soccerwiki_id || row.sw_id || "",
    api_football_id: row.api_football_id || row.api_id || ""
  };
}

const args = parseArgs(process.argv.slice(2));
const registryPath = args.registry ?? "data/players/player-registry.json";
const inputPath = args.input;
const outputPath = args.output ?? "calibration/player-identity-resolution.json";
const outputCsvPath = args.csv ?? outputPath.replace(/\.json$/i, ".csv");

if (!inputPath) {
  console.error("Usage: node scripts/resolve-player-identities.js --input=<rows.csv|json> [--registry=data/players/player-registry.json] [--output=calibration/player-identity-resolution.json]");
  process.exit(1);
}

const registry = await loadRows(registryPath);
const inputRows = await loadRows(inputPath);
const resolver = createPlayerIdentityResolver(registry);

const results = inputRows.map((row) => {
  const query = queryFromRow(row);
  const resolved = resolver.resolve(query);
  return {
    input: row,
    resolution: resolved
  };
});

const flat = results.map(({ input, resolution }) => ({
  input_name: input.name || input.player_name || input.playerName || input.display_name || input.full_name || "",
  matched: Boolean(resolution.matched),
  ambiguous: Boolean(resolution.ambiguous),
  confidence: resolution.confidence ?? 0,
  method: resolution.method,
  tbg_player_id: resolution.tbg_player_id,
  transfermarkt_id: resolution.transfermarkt_id,
  canonical_name: resolution.canonical_name,
  current_club: resolution.current_club,
  position: resolution.position,
  date_of_birth: resolution.date_of_birth,
  candidate_count: resolution.candidates?.length ?? 0,
  reasons: (resolution.reasons ?? []).join("; ")
}));

const summary = {
  input_rows: inputRows.length,
  matched: results.filter((row) => row.resolution.matched).length,
  ambiguous: results.filter((row) => row.resolution.ambiguous).length,
  unmatched: results.filter((row) => !row.resolution.matched && !row.resolution.ambiguous).length,
  by_method: flat.reduce((acc, row) => {
    acc[row.method] = (acc[row.method] ?? 0) + 1;
    return acc;
  }, {})
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify({ summary, results }, null, 2) + "\n", "utf8");
await writeFile(outputCsvPath, writeCsv(flat), "utf8");

console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote identity resolution JSON: ${outputPath}`);
console.log(`Wrote identity resolution CSV: ${outputCsvPath}`);
