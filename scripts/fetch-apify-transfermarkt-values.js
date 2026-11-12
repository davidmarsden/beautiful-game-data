import { ApifyClient } from "apify-client";
import { writeFile, mkdir, readFile } from "node:fs/promises";
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

function usableDatasetId(value) {
  const text = String(value || "").trim();
  const lowered = text.toLowerCase();
  if (!text) return "";
  if (["apifydatasetid", "datasetid", "none", "null", "undefined", "false", "0", "leaveblank", "leave-blank"].includes(lowered)) return "";
  return text;
}

async function idsFromFile(path) {
  if (!path) return [];
  const raw = JSON.parse(await readFile(path, "utf8"));
  const values = Array.isArray(raw) ? raw : raw.player_ids || raw.playerIds || [];
  return values.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

const args = parseArgs(process.argv.slice(2));
const actor = args.actor ?? "jungle_synthesizer/transfermarkt-global-football-player-scraper";
const output = args.output ?? "calibration/apify-transfermarkt-dataset.json";
const scope = String(args.scope ?? "wide");
const includeGoldStandardRescue = booleanArg(args.includeGoldStandardRescue, true);
const includeSearchQueries = booleanArg(args.includeSearchQueries, includeGoldStandardRescue);
const allowSearchWithTargetedIds = booleanArg(args.allowSearchWithTargetedIds, false);
const existingDatasetId = usableDatasetId(args.datasetId || args.apifyDatasetId);
const dryRun = booleanArg(args.dryRun, false);
const hasBudgetMaxItems = args.budgetMaxItems !== undefined;
const budgetMaxItems = hasBudgetMaxItems ? Number(args.budgetMaxItems) : 0;
const searchMaxItems = Math.max(1, Number(args.searchMaxItems ?? 1) || 1);
const maxSearchRuns = Number(args.maxSearchRuns ?? 100);

if (hasBudgetMaxItems && (!Number.isFinite(budgetMaxItems) || budgetMaxItems <= 0)) {
  console.error(`Invalid --budgetMaxItems value: ${String(args.budgetMaxItems)}.`);
  console.error("The Apify budget ceiling must be a finite positive number. Refusing to start an actor without a valid ceiling.");
  process.exit(2);
}

let input;
let searchInputs = [];
if (!existingDatasetId) {
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
      maxItems: Number(args.maxItems ?? (scope === "wide" ? 5000 : 1000))
    };

    const clubIds = parseNumberList(args.clubIds);
    const playerIds = mergeUnique(parseNumberList(args.playerIds), await idsFromFile(args.playerIdsFile)).map(Number);
    const searchQueries = mergeUnique(
      csvList(args.searchQueries),
      includeSearchQueries ? GOLD_STANDARD_RESCUE_PLAYERS : []
    );
    // Explicit --competitionCodes are always honoured; the scope default only applies when nothing
    // else was asked for, so a search-only request never pays for an implicit league scrape.
    const defaultCompetitionCodes = scope === "wide" ? TRANSFERMARKT_WIDE_COMPETITION_CODES : ["GB1"];
    const competitionCodes = args.competitionCodes !== undefined
      ? csvList(args.competitionCodes)
      : searchQueries.length ? [] : defaultCompetitionCodes;

    if (playerIds.length) input.playerIds = playerIds.map(String);
    if (clubIds.length) input.clubIds = clubIds.map(String);
    if (competitionCodes.length && !playerIds.length && !clubIds.length) input.competitionCodes = competitionCodes;

    // The actor takes a single free-text `searchQuery` per run, so each query becomes its own small run.
    if (searchQueries.length && (!playerIds.length && !clubIds.length || allowSearchWithTargetedIds)) {
      searchInputs = searchQueries.map((searchQuery) => ({ searchQuery, maxItems: searchMaxItems }));
    }

    // With only search queries requested, skip the bulk run rather than falling back to a competition scrape.
    if (!input.playerIds && !input.clubIds && !input.competitionCodes) {
      input = searchInputs.length ? null : { ...input, competitionCodes: ["GB1"] };
    }
  }

  if (searchInputs.length > maxSearchRuns) {
    console.error(`Refusing to start ${searchInputs.length} search runs (limit ${maxSearchRuns}). Pass --maxSearchRuns to raise it.`);
    process.exit(2);
  }

  const requestedItems = Number(input?.maxItems || 0) + searchInputs.length * searchMaxItems;
  if (budgetMaxItems > 0 && requestedItems > budgetMaxItems) {
    console.error(`Apify budget guard blocked this run: requested maxItems=${requestedItems}, budgetMaxItems=${budgetMaxItems}.`);
    console.error("Raise --budgetMaxItems explicitly only when the extra paid scrape is intentional.");
    process.exit(2);
  }

  console.log(`Actor: ${actor}`);
  if (input) {
    console.log("Input:");
    console.log(JSON.stringify(input, null, 2));
  }
  if (searchInputs.length) {
    console.log(`Search runs: ${searchInputs.length} (up to ${searchMaxItems} item(s) each): ${searchInputs.map((item) => item.searchQuery).join(", ")}`);
  }
  if (budgetMaxItems > 0) console.log(`Budget guard: at most ${budgetMaxItems} item(s)`);

  if (dryRun) {
    console.log("Dry run: no Apify actor was started and no paid scrape was requested.");
    process.exit(0);
  }
}

const token = process.env.APIFY_TOKEN;
if (!token) {
  console.error("Missing APIFY_TOKEN environment variable.");
  process.exit(1);
}

const client = new ApifyClient({ token });
const datasetLimit = Number(args.datasetLimit ?? 10000);
const datasetIds = [];

async function runActor(runInput, label) {
  const run = await client.actor(actor).call(runInput);
  console.log(`Apify run finished (${label}): ${run.id} status=${run.status}`);
  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify run ${run.id} (${label}) ended with status ${run.status}`);
  }
  console.log(`Dataset: ${run.defaultDatasetId}`);
  datasetIds.push(run.defaultDatasetId);
}

if (existingDatasetId) {
  console.log(`Reusing existing Apify dataset: ${existingDatasetId}`);
  datasetIds.push(existingDatasetId);
} else {
  if (input) await runActor(input, "bulk");
  for (const searchInput of searchInputs) await runActor(searchInput, `search "${searchInput.searchQuery}"`);
}

const items = [];
for (const datasetId of datasetIds) {
  const page = await client.dataset(datasetId).listItems({ limit: datasetLimit });
  items.push(...page.items);
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(items, null, 2)}\n`, "utf8");
console.log(`Wrote ${items.length} Apify item(s) from ${datasetIds.length} dataset(s) to ${output}`);
