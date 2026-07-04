import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createPlayerIdentityResolver, normaliseName } from "../src/identity/playerIdentityResolver.js";

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
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  if (/[,"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function soccerwikiId(row) {
  return String(row.soccerwiki_id || row.sw_id || row.player_id || row.id || row.soccerwikiPlayerId || "").trim();
}

function soccerwikiUrl(row) {
  return String(row.soccerwiki_url || row.url || row.profile_url || row.player_url || "").trim();
}

function soccerwikiName(row) {
  return String(row.name || row.player_name || row.playerName || row.display_name || row.full_name || row.player || "").trim();
}

function soccerwikiClub(row) {
  return String(row.club || row.club_name || row.team || row.team_name || "").trim();
}

function soccerwikiPosition(row) {
  return String(row.position || row.positions || row.pos || "").trim();
}

function soccerwikiRating(row) {
  const raw = row.smwRating || row.smw_rating || row.rating || row.soccerwiki_rating || row.SMW || "";
  const value = Number(raw);
  return Number.isFinite(value) ? value : "";
}

function queryFromSoccerWikiRow(row) {
  return {
    ...row,
    name: soccerwikiName(row),
    player_name: soccerwikiName(row),
    date_of_birth: row.date_of_birth || row.dob || row.birth_date || "",
    position: soccerwikiPosition(row),
    soccerwiki_id: soccerwikiId(row)
  };
}

function shouldAutoLink(resolution, threshold) {
  return Boolean(resolution.matched && !resolution.ambiguous && Number(resolution.confidence ?? 0) >= threshold);
}

function linkRegistry(registry, links) {
  const byTbgId = new Map(registry.map((row) => [row.tbg_player_id, row]));
  for (const link of links) {
    const row = byTbgId.get(link.tbg_player_id);
    if (!row) continue;
    row.soccerwiki_id = link.soccerwiki_id || row.soccerwiki_id || "";
    row.soccerwiki_url = link.soccerwiki_url || row.soccerwiki_url || "";
    row.soccerwiki_rating = link.soccerwiki_rating || row.soccerwiki_rating || "";
    row.soccerwiki_name = link.soccerwiki_name || row.soccerwiki_name || "";
    row.aliases = unique([...(row.aliases ?? []), link.soccerwiki_name].filter((value) => value && value !== row.canonical_name));
    row.alias_keys = unique([...(row.alias_keys ?? []), normaliseName(link.soccerwiki_name)]);
    row.last_linked_source = "soccerwiki";
    row.last_linked_at = new Date().toISOString();
  }
  return registry;
}

function registryCsv(records) {
  const headers = [
    "tbg_player_id",
    "canonical_name",
    "display_name",
    "full_name",
    "name_key",
    "date_of_birth",
    "nationality",
    "primary_position",
    "position_category",
    "transfermarkt_id",
    "soccerwiki_id",
    "soccerwiki_rating",
    "api_football_id",
    "current_club",
    "current_competition_code",
    "status",
    "last_seen_source",
    "last_seen_at"
  ];
  return [headers.join(","), ...records.map((record) => headers.map((header) => csvEscape(record[header])).join(","))].join("\n") + "\n";
}

function reportCsv(rows) {
  const headers = [
    "bucket",
    "soccerwiki_name",
    "soccerwiki_id",
    "soccerwiki_rating",
    "soccerwiki_club",
    "confidence",
    "method",
    "tbg_player_id",
    "transfermarkt_id",
    "canonical_name",
    "current_club",
    "position",
    "reasons"
  ];
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n";
}

const args = parseArgs(process.argv.slice(2));
const registryPath = args.registry ?? "data/players/player-registry.json";
const registryCsvPath = args.registryCsv ?? "data/players/player-registry.csv";
const soccerwikiPath = args.soccerwiki ?? args.input ?? "calibration/smw-ratings-enriched.csv";
const reportPath = args.report ?? "calibration/soccerwiki-link-report.json";
const reportCsvPath = args.reportCsv ?? reportPath.replace(/\.json$/i, ".csv");
const autoThreshold = args.autoThreshold ? Number(args.autoThreshold) : 0.9;
const writeRegistry = args.writeRegistry !== "false";

const registry = await loadRows(registryPath);
const soccerwikiRows = await loadRows(soccerwikiPath);
const resolver = createPlayerIdentityResolver(registry);

const reportRows = [];
const autoLinks = [];

for (const swRow of soccerwikiRows) {
  const resolution = resolver.resolve(queryFromSoccerWikiRow(swRow));
  const bucket = shouldAutoLink(resolution, autoThreshold) ? "auto_link" : resolution.ambiguous ? "review" : "unmatched";
  const row = {
    bucket,
    soccerwiki_name: soccerwikiName(swRow),
    soccerwiki_id: soccerwikiId(swRow),
    soccerwiki_url: soccerwikiUrl(swRow),
    soccerwiki_rating: soccerwikiRating(swRow),
    soccerwiki_club: soccerwikiClub(swRow),
    soccerwiki_position: soccerwikiPosition(swRow),
    confidence: resolution.confidence ?? 0,
    method: resolution.method,
    tbg_player_id: resolution.tbg_player_id,
    transfermarkt_id: resolution.transfermarkt_id,
    canonical_name: resolution.canonical_name,
    current_club: resolution.current_club,
    position: resolution.position,
    date_of_birth: resolution.date_of_birth,
    reasons: (resolution.reasons ?? []).join("; "),
    candidates: resolution.candidates ?? []
  };
  reportRows.push(row);
  if (bucket === "auto_link") autoLinks.push(row);
}

if (writeRegistry) {
  const updated = linkRegistry(registry, autoLinks);
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, JSON.stringify(updated, null, 2) + "\n", "utf8");
  await writeFile(registryCsvPath, registryCsv(updated), "utf8");
}

const summary = {
  soccerwiki_rows: soccerwikiRows.length,
  auto_linked: autoLinks.length,
  review: reportRows.filter((row) => row.bucket === "review").length,
  unmatched: reportRows.filter((row) => row.bucket === "unmatched").length,
  auto_threshold: autoThreshold,
  generated_at: new Date().toISOString(),
  by_method: reportRows.reduce((acc, row) => {
    acc[row.method] = (acc[row.method] ?? 0) + 1;
    return acc;
  }, {})
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify({ summary, rows: reportRows }, null, 2) + "\n", "utf8");
await writeFile(reportCsvPath, reportCsv(reportRows), "utf8");

console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote SoccerWiki link report: ${reportPath}`);
console.log(`Wrote SoccerWiki link report CSV: ${reportCsvPath}`);
if (writeRegistry) console.log(`Updated registry: ${registryPath}`);
