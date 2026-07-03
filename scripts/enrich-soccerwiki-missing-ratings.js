import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseSoccerWikiRatingsHtml, ratingsToCsv } from "../src/soccerwiki/scrapeRatings.js";
import { matchIdentity, playerClubKey, playerIdentityKey } from "../src/ratingModel/playerIdentity.js";

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
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
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

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadTargets(path) {
  const text = await readFile(path, "utf8");
  return path.endsWith(".json") ? JSON.parse(text) : parseCsv(text);
}

function playerClub(player) {
  return player.team?.name ?? player.clubName ?? player.teamName ?? "";
}

function playerRating(player) {
  return Number(player.ratings?.effectiveMatchRating ?? player.ratings?.ability ?? player.ability ?? player.rating ?? 0);
}

function existingMatch(player, targets, options = {}) {
  const club = playerClub(player);
  const exactClub = targets.find((target) => playerClubKey(target.name, target.club) === playerClubKey(player.name, club));
  if (exactClub) return exactClub;
  const identity = matchIdentity({ name: player.name, club }, targets, options).match;
  if (identity) return identity;
  return targets.find((target) => playerIdentityKey(target.name) === playerIdentityKey(player.name)) ?? null;
}

function searchNamesForPlayer(player) {
  const name = String(player.name ?? "").replace(/&apos;/g, "'").trim();
  const names = new Set([name]);
  const initialMatch = name.match(/^([A-Z])\.\s+(.+)$/i);
  if (initialMatch) names.add(initialMatch[2]);
  return [...names].filter(Boolean);
}

function soccerWikiSearchUrl(query, baseUrl = "https://en.soccerwiki.org/search/player") {
  const url = new URL(baseUrl);
  url.searchParams.set("search", query);
  return url.toString();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent": options.userAgent ?? "BeautifulGameBot/0.1 (+https://github.com/davidmarsden/beautiful-game-data)",
      accept: "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`SoccerWiki request failed ${response.status}: ${url}`);
  return response.text();
}

function bestSearchResult(player, rows, options = {}) {
  return matchIdentity(
    { name: player.name, club: playerClub(player) },
    rows,
    { minConfidence: Number(options.minConfidence ?? 0.85), clubTieBreakConfidence: Number(options.clubTieBreakConfidence ?? 0.85) }
  ).match;
}

function mergeRows(existingRows, newRows) {
  const byUrl = new Map();
  const byIdentity = new Map();
  const output = [];
  for (const row of [...existingRows, ...newRows]) {
    const url = row.soccerwikiUrl ?? row.raw?.soccerwikiUrl;
    const identity = playerClubKey(row.name, row.club);
    if (url && byUrl.has(url)) continue;
    if (!url && byIdentity.has(identity)) continue;
    output.push(row);
    if (url) byUrl.set(url, row);
    byIdentity.set(identity, row);
  }
  return output.sort((a, b) => Number(b.smwRating ?? 0) - Number(a.smwRating ?? 0) || String(a.name).localeCompare(String(b.name)));
}

const args = parseArgs(process.argv.slice(2));

if (!args.pack || !args.targets) {
  console.error("Usage: node scripts/enrich-soccerwiki-missing-ratings.js --pack=<league-pack.json> --targets=<smw-ratings.csv> [--output=calibration/smw-ratings-enriched.csv] [--minModelRating=83]");
  process.exit(1);
}

const output = args.output ?? args.targets;
const minModelRating = Number(args.minModelRating ?? 83);
const limit = Number(args.limit ?? 80);
const delayMs = Number(args.delayMs ?? 1000);
const pack = await loadJson(args.pack);
const targets = await loadTargets(args.targets);
const players = Object.values(pack.players ?? {})
  .filter((player) => playerRating(player) >= minModelRating)
  .sort((a, b) => playerRating(b) - playerRating(a) || String(a.name).localeCompare(String(b.name)));

const missing = players.filter((player) => !existingMatch(player, targets, { minConfidence: 0.95 })).slice(0, limit);
const found = [];
const misses = [];

console.log(`Checking ${missing.length} missing high-rated API player(s).`);

for (const player of missing) {
  let match = null;
  for (const query of searchNamesForPlayer(player)) {
    const url = soccerWikiSearchUrl(query, args.baseUrl);
    console.log(`Searching SoccerWiki: ${query}`);
    const html = await fetchText(url, { userAgent: args.userAgent });
    const rows = parseSoccerWikiRatingsHtml(html);
    match = bestSearchResult(player, rows, { minConfidence: Number(args.minConfidence ?? 0.85) });
    if (match) break;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (match) {
    found.push(match);
    console.log(`  found ${match.name} (${match.club ?? "unknown"}) ${match.smwRating}`);
  } else {
    misses.push({ name: player.name, club: playerClub(player), modelRating: playerRating(player) });
    console.log(`  no match for ${player.name} (${playerClub(player)})`);
  }

  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const merged = mergeRows(targets, found);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, ratingsToCsv(merged), "utf8");

const reportPath = args.report ?? output.replace(/\.csv$/i, "-enrichment-report.json");
await writeFile(reportPath, `${JSON.stringify({ checked: missing.length, found: found.length, misses, foundRows: found }, null, 2)}\n`, "utf8");

console.log(`Wrote ${merged.length} SoccerWiki ratings to ${output}`);
console.log(`Found ${found.length}/${missing.length} missing ratings. Report: ${reportPath}`);
