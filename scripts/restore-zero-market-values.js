import { readFile, writeFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const masterPath = args.master || "data/transfermarkt/players-master.json";
const zeroIdsPaths = String(args.zeroIds || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!zeroIdsPaths.length) {
  console.error("Usage: node scripts/restore-zero-market-values.js --zeroIds=file1.json,file2.json");
  process.exit(1);
}

const master = JSON.parse(await readFile(masterPath, "utf8"));
const zeroIds = new Set();
for (const path of zeroIdsPaths) {
  const ids = JSON.parse(await readFile(path, "utf8"));
  for (const id of ids) zeroIds.add(String(id));
}

let restored = 0;
for (const player of master) {
  const id = String(player.transfermarkt_id || player.player_id || "");
  if (!zeroIds.has(id)) continue;
  if (player.market_value_eur !== 0) restored += 1;
  player.market_value_eur = 0;
}

await writeFile(masterPath, JSON.stringify(master, null, 2) + "\n", "utf8");
console.log(`Restored ${restored} zero-market-value player(s) in ${masterPath}.`);
