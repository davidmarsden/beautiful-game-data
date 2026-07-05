import { readFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

function csvEscapeForGithubOutput(value) {
  return String(value ?? "")
    .replace(/%/g, "%25")
    .replace(/\n/g, "%0A")
    .replace(/\r/g, "%0D");
}

const args = parseArgs(process.argv.slice(2));
const input = args.input ?? "data/calibration/tbg-gold-standard-players.json";
const format = args.format ?? "plain";
const rows = JSON.parse(await readFile(input, "utf8"));
const names = [...new Set(rows.map((row) => row.name).filter(Boolean))];

if (format === "github-output") {
  console.log(`searchQueries=${csvEscapeForGithubOutput(names.join(","))}`);
  console.log(`maxItems=${Math.max(150, names.length * 2)}`);
  console.log(`count=${names.length}`);
} else if (format === "json") {
  console.log(JSON.stringify({ count: names.length, searchQueries: names }, null, 2));
} else {
  console.log(names.join(","));
}
