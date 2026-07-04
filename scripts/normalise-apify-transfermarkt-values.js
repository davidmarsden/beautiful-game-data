import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { marketValueFromRow } from "../src/ratingModel/trainSmwModel.js";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[,"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function pick(row, names, fallback = "") {
  for (const name of names) {
    if (row?.[name] !== undefined && row?.[name] !== null && row?.[name] !== "") return row[name];
  }
  return fallback;
}

function objectValues(value) {
  if (!value || typeof value !== "object") return [];
  return Object.values(value).filter((item) => item && typeof item === "object");
}

function flattenRows(value) {
  if (Array.isArray(value)) return value.flatMap(flattenRows);
  if (!value || typeof value !== "object") return [];
  const candidateArrays = [
    value.items,
    value.data,
    value.players,
    value.player,
    value.result,
    value.results,
    value.dataset,
    value.records,
    value.table,
    value.rows,
    value.squad,
    value.squadPlayers,
    value.playersTable,
    value.marketValues
  ].filter(Array.isArray);
  if (candidateArrays.length) return candidateArrays.flatMap(flattenRows);
  return [value];
}

function deepFindString(row, patterns) {
  const stack = [row];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    if (typeof current === "object") seen.add(current);
    if (typeof current === "string" || typeof current === "number") {
      const text = String(current).trim();
      if (patterns.some((pattern) => pattern.test(text))) return text;
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else if (typeof current === "object") {
      for (const item of Object.values(current)) stack.push(item);
    }
  }
  return "";
}

function deepFindByKey(row, keyPatterns) {
  const stack = [row];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const [key, value] of Object.entries(current)) {
      if (value !== undefined && value !== null && value !== "" && keyPatterns.some((pattern) => pattern.test(key))) return value;
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return "";
}

function playerName(row) {
  const direct = pick(row, [
    "player_name",
    "playerName",
    "name",
    "player",
    "Player",
    "playerFullName",
    "fullName",
    "full_name",
    "spieler",
    "player_name_text"
  ]);
  if (typeof direct === "object") return pick(direct, ["name", "playerName", "fullName", "text", "title", "label"]);
  if (direct) return direct;
  const byKey = deepFindByKey(row, [/player.*name/i, /full.*name/i, /^name$/i, /spieler/i]);
  if (typeof byKey === "object") return pick(byKey, ["name", "text", "title", "label"]);
  return byKey;
}

function clubName(row) {
  const direct = pick(row, [
    "club",
    "clubName",
    "team",
    "teamName",
    "squad",
    "currentClub",
    "current_club",
    "Club",
    "verein"
  ]);
  if (typeof direct === "object") return pick(direct, ["name", "clubName", "teamName", "text", "title", "label"]);
  if (direct) return direct;
  const byKey = deepFindByKey(row, [/club/i, /team/i, /squad/i, /verein/i]);
  if (typeof byKey === "object") return pick(byKey, ["name", "text", "title", "label"]);
  return byKey;
}

function marketValue(row) {
  const direct = marketValueFromRow(row);
  if (direct) return direct;
  const byKey = deepFindByKey(row, [/market.*value/i, /marktwert/i, /^value$/i, /price/i]);
  const keyed = marketValueFromRow({ market_value: byKey });
  if (keyed) return keyed;
  return marketValueFromRow({
    market_value: pick(row, [
      "marketValue",
      "market_value",
      "marketValueText",
      "market_value_text",
      "value",
      "Value",
      "price",
      "currentMarketValue"
    ]) || deepFindString(row, [/^[€£$]\s*\d+(?:\.\d+)?\s*(?:m|k|bn|b)?$/i])
  });
}

function normaliseRow(row) {
  const name = String(playerName(row) ?? "").trim();
  const club = String(clubName(row) ?? "").trim();
  const marketValueEur = marketValue(row);
  if (!name || !marketValueEur) return null;

  return {
    player_name: name,
    club,
    position: pick(row, ["position", "Position", "mainPosition", "main_position", "player_position"]) || deepFindByKey(row, [/position/i, /pos$/i]),
    age: pick(row, ["age", "Age"]) || deepFindByKey(row, [/^age$/i, /alter/i]),
    nationality: pick(row, ["nationality", "Nationality", "country", "countryName"]) || deepFindByKey(row, [/nationality/i, /country/i, /nation/i]),
    market_value_eur: marketValueEur,
    market_value: pick(row, ["marketValue", "market_value", "marketValueText", "market_value_text", "value", "Value"]) || deepFindString(row, [/^[€£$]\s*\d+(?:\.\d+)?\s*(?:m|k|bn|b)?$/i]),
    transfermarkt_url: pick(row, ["url", "playerUrl", "player_url", "profileUrl", "profile_url", "link", "href"]) || deepFindString(row, [/transfermarkt\.(com|co\.uk).*spieler/i, /\/profil\/spieler\//i]),
    source: "apify-transfermarkt"
  };
}

function describeShape(rows) {
  const keyCounts = new Map();
  for (const row of rows) {
    for (const key of Object.keys(row ?? {})) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  return {
    rowCount: rows.length,
    topLevelKeys: [...keyCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 80),
    samples: rows.slice(0, 5).map((row) => ({ keys: Object.keys(row ?? {}), row }))
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args.output) {
  console.error("Usage: node scripts/normalise-apify-transfermarkt-values.js --input=apify-transfermarkt.json --output=calibration/transfermarkt-values.csv");
  process.exit(1);
}

const raw = JSON.parse(await readFile(args.input, "utf8"));
const rows = flattenRows(raw);
const normalised = [];
const seen = new Set();

for (const row of rows) {
  const clean = normaliseRow(row);
  if (!clean) continue;
  const key = `${clean.player_name.toLowerCase()}|${clean.club.toLowerCase()}|${clean.market_value_eur}`;
  if (seen.has(key)) continue;
  seen.add(key);
  normalised.push(clean);
}

const headers = ["player_name", "club", "position", "age", "nationality", "market_value_eur", "market_value", "transfermarkt_url", "source"];
const csv = [headers.join(","), ...normalised.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
await mkdir(dirname(args.output), { recursive: true });
await writeFile(args.output, `${csv}\n`, "utf8");

const diagnosticsPath = args.diagnostics ?? args.output.replace(/\.csv$/i, "-shape.json");
await writeFile(diagnosticsPath, `${JSON.stringify(describeShape(rows), null, 2)}\n`, "utf8");

console.log(`Read ${rows.length} Apify row(s).`);
console.log(`Wrote ${normalised.length} normalised Transfermarkt value row(s) to ${args.output}.`);
console.log(`Wrote Apify dataset shape diagnostics to ${diagnosticsPath}.`);
if (!normalised.length) {
  console.error("No usable player market values found. Check the Apify dataset shape diagnostics artifact.");
  process.exit(1);
}
