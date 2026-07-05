import { ApifyClient } from "apify-client";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  GOLD_STANDARD_RESCUE_PLAYERS,
  TRANSFERMARKT_GENERIC_START_URLS,
  TRANSFERMARKT_WIDE_COMPETITION_CODES
} from "./transfermarkt-scope.js";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

function csvList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumberList(value) {
  return csvList(value).map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function booleanArg(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (value === true || value === "true" || value === "1" || value === "yes") return true;
  if (value === false || value === "false" || value === "0" || value === "no") return false;
  return defaultValue;
}

function mergeUnique(...lists) {
  return [...new Set(lists.flat().map(String).map((item) => item.trim()).filter(Boolean))];
}

const args = parseArgs(process.argv.slice(2));

const token = process.env.APIFY_TOKEN;
if (!token) {
  console.error("Missing APIFY_TOKEN environment variable.");
  process.exit(1);
}

const actor = args.actor ?? "jungle_synthesizer/transfermarkt-global-football-player-scraper";
const output = args.output ?? "calibration/apify-transfermarkt-dataset.json";
const scope = String(args.scope ?? "wide");
const includeGoldStandardRescue = booleanArg(args.includeGoldStandardRescue, true);
const includeSearchQueries = booleanArg(args.includeSearchQueries, includeGoldStandardRescue);

let input;
if (String(args.mode ?? "players") === "generic") {
  const defaultStartUrls = scope === "wide" ? TRANSFERMARKT_GENERIC_START_URLS : ["https://www.transfermarkt.com/premier-league/startseite/wettbewerb/GB1"];
  const startUrls = csvList(args.startUrls || defaultStartUrls.join(",")).map((url) => ({ url }));
  input = {
    startUrls,
    proxyConfig: { useApifyProxy: true },
    crawlDepth: Number(args.crawlDepth ?? 1),
    pageDepth: Number(args.pageDepth ?? 1)
  };
} else {
  input = {
    maxItems: Number(args.maxItems ?? (scope === "wide" ? 5000 : 1000)),
    proxyConfiguration: { useApifyProxy: true }
  };

  const defaultCompetitionCodes = scope === "wide" ? TRANSFERMARKT_WIDE_COMPETITION_CODES : ["GB1"];
  const competitionCodes = csvList(args.competitionCodes ?? defaultCompetitionCodes.join(","));
  const clubIds = parseNumberList(args.clubIds);
  const playerIds = parseNumberList(args.playerIds);
  const searchQueries = mergeUnique(
    csvList(args.searchQueries),
    includeSearchQueries ? GOLD_STANDARD_RESCUE_PLAYERS : []
  );

  // Keep the targeted overrides explicit, but allow league scope and rescue-name
  // search to run together. The previous else-if chain meant a league sweep could
  // never also pull gold-standard missing players by name.
  if (playerIds.length) input.playerIds = playerIds.map(String);
  if (clubIds.length) input.clubIds = clubIds.map(String);
  if (competitionCodes.length && !playerIds.length && !clubIds.length) input.competitionCodes = competitionCodes;
  if (searchQueries.length && !playerIds.length && !clubIds.length) input.searchQueries = searchQueries;
  if (!input.playerIds && !input.clubIds && !input.competitionCodes && !input.searchQueries) input.competitionCodes = ["GB1"];
}

console.log(`Actor: ${actor}`);
console.log("Input:");
console.log(JSON.stringify(input, null, 2));

const client = new ApifyClient({ token });
const run = await client.actor(actor).call(input);

console.log(`Apify run finished: ${run.id}`);
console.log(`Dataset: ${run.defaultDatasetId}`);

const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: Number(args.datasetLimit ?? 10000) });

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(items, null, 2)}\n`, "utf8");

console.log(`Wrote ${items.length} Apify item(s) to ${output}`);
