import { ApifyClient } from "apify-client";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

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

const args = parseArgs(process.argv.slice(2));

const token = process.env.APIFY_TOKEN;
if (!token) {
  console.error("Missing APIFY_TOKEN environment variable.");
  process.exit(1);
}

const actor = args.actor ?? "jungle_synthesizer/transfermarkt-global-football-player-scraper";
const output = args.output ?? "calibration/apify-transfermarkt-dataset.json";

let input;
if (String(args.mode ?? "players") === "generic") {
  const startUrls = csvList(args.startUrls || "https://www.transfermarkt.com/premier-league/startseite/wettbewerb/GB1").map((url) => ({ url }));
  input = {
    startUrls,
    proxyConfig: { useApifyProxy: true },
    crawlDepth: Number(args.crawlDepth ?? 1),
    pageDepth: Number(args.pageDepth ?? 1)
  };
} else {
  input = {
    maxItems: Number(args.maxItems ?? 1000),
    proxyConfiguration: { useApifyProxy: true }
  };

  const competitionCodes = csvList(args.competitionCodes ?? "GB1");
  const clubIds = parseNumberList(args.clubIds);
  const playerIds = parseNumberList(args.playerIds);
  const searchQueries = csvList(args.searchQueries);

  if (playerIds.length) input.playerIds = playerIds.map(String);
  else if (clubIds.length) input.clubIds = clubIds.map(String);
  else if (competitionCodes.length) input.competitionCodes = competitionCodes;
  else if (searchQueries.length) input.searchQueries = searchQueries;
  else input.competitionCodes = ["GB1"];
}

console.log(`Actor: ${actor}`);
console.log("Input:");
console.log(JSON.stringify(input, null, 2));

const client = new ApifyClient({ token });
const run = await client.actor(actor).call(input);

console.log(`Apify run finished: ${run.id}`);
console.log(`Dataset: ${run.defaultDatasetId}`);

const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: Number(args.datasetLimit ?? 5000) });

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(items, null, 2)}\n`, "utf8");

console.log(`Wrote ${items.length} Apify item(s) to ${output}`);
