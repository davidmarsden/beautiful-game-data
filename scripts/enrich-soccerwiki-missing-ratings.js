import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseSoccerWikiRatingsHtml, ratingsToCsv } from "../src/soccerwiki/scrapeRatings.js";
import { matchIdentity, normaliseClub, normaliseName, playerClubKey, playerIdentityKey } from "../src/ratingModel/playerIdentity.js";

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
  const original = String(player.name ?? "").replace(/&apos;/g, "'").trim();
  const normalised = normaliseName(original);
  const tokens = normalised.split(/\s+/).filter(Boolean);
  const names = new Set();

  const initialMatch = original.match(/^([A-Z])\.\s+(.+)$/i);
  if (tokens.length) names.add(tokens.at(-1));
  if (tokens.length >= 2) names.add(tokens.slice(-2).join(" "));
  if (initialMatch) names.add(initialMatch[2]);
  names.add(original);
  names.add(normalised);

  return [...names].filter(Boolean);
}

function soccerWikiSearchUrl(query, baseUrl = "https://en.soccerwiki.org/search.php") {
  const url = new URL(baseUrl);
  url.searchParams.set("q", query);
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

function tokens(value) {
  return normaliseName(value).split(/\s+/).filter(Boolean);
}

function rescueScore(player, row) {
  const playerTokens = tokens(player.name);
  const rowTokens = tokens(row.name);
  const playerClubName = normaliseClub(playerClub(player));
  const rowClubName = normaliseClub(row.club);
  const sameClub = Boolean(playerClubName && rowClubName && playerClubName === rowClubName);
  const playerLast = playerTokens.at(-1);
  const rowLast = rowTokens.at(-1);
  const surnameMatch = Boolean(playerLast && rowTokens.includes(playerLast)) || Boolean(rowLast && playerTokens.includes(rowLast));
  const firstMatch = Boolean(playerTokens[0] && rowTokens[0] && playerTokens[0][0] === rowTokens[0][0]);
  const tokenOverlap = playerTokens.filter((token) => rowTokens.includes(token)).length;

  let score = 0;
  if (sameClub) score += 0.45;
  if (surnameMatch) score += 0.35;
  if (firstMatch) score += 0.15;
  if (tokenOverlap) score += Math.min(0.25, tokenOverlap * 0.1);
  if (Number(row.smwRating ?? 0) >= 80) score += 0.05;
  return score;
}

function rescueSearchResult(player, rows) {
  const ranked = rows
    .map((row) => ({ ...row, rescueScore: rescueScore(player, row) }))
    .filter((row) => row.rescueScore >= 0.55)
    .sort((a, b) => b.rescueScore - a.rescueScore || Number(b.smwRating ?? 0) - Number(a.smwRating ?? 0));
  return ranked[0] ?? null;
}

function bestSearchResult(player, rows, options = {}) {
  const identityResult = matchIdentity(
    { name: player.name, club: playerClub(player) },
    rows,
    { minConfidence: Number(options.minConfidence ?? 0.85), clubTieBreakConfidence: Number(options.clubTieBreakConfidence ?? 0.85) }
  );
  return identityResult.match ?? rescueSearchResult(player, rows);
}

function debugCandidates(player, rows) {
  const identityResult = matchIdentity({ name: player.name, club: playerClub(player) }, rows, { minConfidence: 2 });
  const rescueRows = rows.map((row) => ({ ...row, rescueScore: rescueScore(player, row) }));
  const byName = new Map();
  for (const row of [...identityResult.candidates, ...rescueRows]) {
    const key = `${row.name}|${row.club}|${row.smwRating}`;
    const existing = byName.get(key);
    if (!existing || Number(row.confidence ?? 0) > Number(existing.confidence ?? 0) || Number(row.rescueScore ?? 0) > Number(existing.rescueScore ?? 0)) {
      byName.set(key, row);
    }
  }
  return [...byName.values()]
    .sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0) || Number(b.rescueScore ?? 0) - Number(a.rescueScore ?? 0) || Number(b.smwRating ?? 0) - Number(a.smwRating ?? 0))
    .slice(0, 5);
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
  let lastRows = [];
  for (const query of searchNamesForPlayer(player)) {
    const url = soccerWikiSearchUrl(query, args.baseUrl);
    console.log(`Searching SoccerWiki: ${query} (${url})`);
    const html = await fetchText(url, { userAgent: args.userAgent });
    const rows = parseSoccerWikiRatingsHtml(html);
    lastRows = rows;
    console.log(`  parsed ${rows.length} player row(s)`);
    if (rows.length) {
      console.log(`  sample: ${rows.slice(0, 3).map((row) => `${row.name} / ${row.club ?? "?"} / ${row.smwRating}`).join(" | ")}`);
    }
    match = bestSearchResult(player, rows, { minConfidence: Number(args.minConfidence ?? 0.85) });
    if (match) break;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (match) {
    found.push(match);
    console.log(`  found ${match.name} (${match.club ?? "unknown"}) ${match.smwRating}`);
  } else {
    const candidates = debugCandidates(player, lastRows);
    if (candidates.length) {
      console.log(`  rejected candidates: ${candidates.map((row) => `${row.name} (${row.club ?? "?"}, ${row.smwRating}) confidence=${row.confidence ?? "-"} rescue=${row.rescueScore ?? "-"}`).join(" | ")}`);
    }
    misses.push({ name: player.name, club: playerClub(player), modelRating: playerRating(player), candidates });
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
