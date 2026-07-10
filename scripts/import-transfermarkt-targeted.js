import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

function parseArgs(argv) {
  return Object.fromEntries(argv.map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env, shell: process.platform === "win32" });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)));
  });
}

const args = parseArgs(process.argv.slice(2));
const playerIds = String(args.playerIds || "").trim();
const clubIds = String(args.clubIds || "").trim();
const searchQueries = String(args.searchQueries || "").trim();
const datasetId = String(args.datasetId || "").trim();

if (!playerIds && !clubIds && !searchQueries && !datasetId) {
  console.error("Usage: node scripts/import-transfermarkt-targeted.js --playerIds=123,456 OR --clubIds=10,20 OR --searchQueries=Kees%20Smit");
  process.exit(1);
}

await mkdir("calibration/targeted", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = args.output || `calibration/targeted/apify-transfermarkt-targeted-${stamp}.json`;
const fetchArgs = [
  "scripts/fetch-apify-transfermarkt-values.js",
  "--scope=targeted",
  `--output=${output}`,
  "--includeGoldStandardRescue=false",
  "--includeSearchQueries=false",
  "--allowSearchWithTargetedIds=true",
  `--maxItems=${args.maxItems || 500}`
];
if (playerIds) fetchArgs.push(`--playerIds=${playerIds}`);
if (clubIds) fetchArgs.push(`--clubIds=${clubIds}`);
if (searchQueries) fetchArgs.push(`--searchQueries=${searchQueries}`);
if (datasetId) fetchArgs.push(`--datasetId=${datasetId}`);

console.log("Fetching targeted Transfermarkt records...");
await run("node", fetchArgs);
console.log("Merging targeted records into players master...");
await run("node", ["scripts/import-transfermarkt-master.js", `--input=${output}`, "--mergeExisting=true"]);
console.log("Rebuilding player registry...");
await run("npm", ["run", "build:player-registry"]);
console.log("Rebuilding wider player registry...");
await run("npm", ["run", "build:wider-player-registry"]);
console.log("Targeted import complete.");
console.log("Next: run npm run rebuild:published-player-database");
