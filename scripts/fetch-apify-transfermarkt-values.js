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

const args = parseArgs(process.argv.slice(2));

const token = process.env.APIFY_TOKEN;
if (!token) {
  console.error("Missing APIFY_TOKEN environment variable.");
  process.exit(1);
}

const startUrls = String(args.startUrls || "https://www.transfermarkt.com/premier-league/startseite/wettbewerb/GB1")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean)
  .map((url) => ({ url }));

const input = {
  startUrls,
  proxyConfig: { useApifyProxy: true },
  crawlDepth: Number(args.crawlDepth ?? 1),
  pageDepth: Number(args.pageDepth ?? 1)
};

const output = args.output ?? "calibration/apify-transfermarkt-dataset.json";

const client = new ApifyClient({ token });
const run = await client.actor("curious_coder/transfermarkt").call(input);

console.log(`Apify run finished: ${run.id}`);
console.log(`Dataset: ${run.defaultDatasetId}`);

const { items } = await client.dataset(run.defaultDatasetId).listItems();

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(items, null, 2)}\n`, "utf8");

console.log(`Wrote ${items.length} Apify item(s) to ${output}`);