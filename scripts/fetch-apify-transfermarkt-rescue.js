import { ApifyClient } from "apify-client";
import { readFile, writeFile, mkdir } from "node:fs/promises";
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

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function mergeByTransfermarktIdentity(existingItems, newItems) {
  const byKey = new Map();
  for (const item of [...existingItems, ...newItems]) {
    const key = String(item.transfermarkt_id ?? item.player_id ?? `${item.display_name ?? item.full_name}|${item.date_of_birth ?? ""}`);
    if (!key || key === "|") continue;
    byKey.set(key, item);
  }
  return [...byKey.values()];
}

const args = parseArgs(process.argv.slice(2));

const token = process.env.APIFY_TOKEN;
if (!token) {
  console.error("Missing APIFY_TOKEN environment variable.");
  process.exit(1);
}

const actor = args.actor ?? "jungle_synthesizer/transfermarkt-global-football-player-scraper";
const missingQueriesPath = args.missingQueries ?? "calibration/transfermarkt-gold-standard-missing-queries.json";
const output = args.output ?? "calibration/apify-transfermarkt-rescue-dataset.json";
const batchSize = Number(args.batchSize ?? 5);
const maxItemsPerQuery = Number(args.maxItemsPerQuery ?? 5);
const datasetLimit = Number(args.datasetLimit ?? 500);
const explicitQueries = csvList(args.searchQueries);
const missingQueries = explicitQueries.length ? explicitQueries : JSON.parse(await readFile(missingQueriesPath, "utf8"));
const queries = [...new Set(missingQueries.map(String).map((item) => item.trim()).filter(Boolean))];

if (!queries.length) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, "[]\n", "utf8");
  console.log("No missing Transfermarkt gold-standard players to rescue.");
  console.log(`Wrote empty rescue dataset: ${output}`);
  process.exit(0);
}

const client = new ApifyClient({ token });
let rescuedItems = [];
let batchNumber = 0;

for (const batch of chunk(queries, batchSize)) {
  batchNumber += 1;
  const input = {
    maxItems: Math.max(batch.length * maxItemsPerQuery, batch.length),
    proxyConfiguration: { useApifyProxy: true },
    searchQueries: batch
  };

  console.log(`Rescue batch ${batchNumber}: ${batch.join(", ")}`);
  console.log(JSON.stringify(input, null, 2));

  const run = await client.actor(actor).call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: datasetLimit });
  console.log(`Batch ${batchNumber} returned ${items.length} item(s).`);
  rescuedItems = mergeByTransfermarktIdentity(rescuedItems, items);
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(rescuedItems, null, 2)}\n`, "utf8");

console.log(`Rescue queries: ${queries.length}`);
console.log(`Wrote ${rescuedItems.length} unique rescue item(s) to ${output}`);
