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

function flattenRows(value) {
  if (Array.isArray(value)) return value.flatMap(flattenRows);
  if (!value || typeof value !== "object") return [];
  const candidateArrays = [
    value.items,
    value.data,
    value.players,
    value.result,
    value.results,
    value.dataset,
    value.records
  ].filter(Array.isArray);
  if (candidateArrays.length) return candidateArrays.flatMap(flattenRows);
  return [value];
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
    "full_name"
  ]);
  if (typeof direct === "object") return pick(direct, ["name", "playerName", "fullName"]);
  return direct;
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
    "Club"
  ]);
  if (typeof direct === "object") return pick(direct, ["name", "clubName", "teamName"]);
  return direct;
}

function marketValue(row) {
  const direct = marketValueFromRow(row);
  if (direct) return direct;
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
    ])
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
    position: pick(row, ["position", "Position", "mainPosition", "main_position", "player_position"]),
    age: pick(row, ["age", "Age"]),
    nationality: pick(row, ["nationality", "Nationality", "country", "countryName"]),
    market_value_eur: marketValueEur,
    market_value: pick(row, ["marketValue", "market_value", "marketValueText", "market_value_text", "value", "Value"]),
    transfermarkt_url: pick(row, ["url", "playerUrl", "player_url", "profileUrl", "profile_url", "link", "href"]),
    source: "apify-transfermarkt"
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

console.log(`Read ${rows.length} Apify row(s).`);
console.log(`Wrote ${normalised.length} normalised Transfermarkt value row(s) to ${args.output}.`);
if (!normalised.length) {
  console.error("No usable player market values found. Check the Apify dataset shape.");
  process.exit(1);
}
