import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { diagnoseSmwPlayerMatches, formatSmwMatchDiagnostics } from "../src/ratingModel/smwMatchDiagnostics.js";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadTargets(path) {
  const text = await readFile(path, "utf8");
  return path.endsWith(".json") ? JSON.parse(text) : parseCsv(text);
}

const args = parseArgs(process.argv.slice(2));

if (!args.pack || !args.targets) {
  console.error("Usage: node scripts/diagnose-smw-matches.js --pack=<league-pack.json> --targets=<smw-ratings.csv> [--json=diagnostics.json] [--text=diagnostics.md]");
  process.exit(1);
}

const pack = await loadJson(args.pack);
const targets = await loadTargets(args.targets);
const report = diagnoseSmwPlayerMatches(pack, targets, {
  limit: args.limit ? Number(args.limit) : 40,
  suggestionLimit: args.suggestionLimit ? Number(args.suggestionLimit) : 5
});
const text = formatSmwMatchDiagnostics(report);

console.log(text);

if (args.json) {
  await mkdir(dirname(args.json), { recursive: true });
  await writeFile(args.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\nWrote JSON diagnostics: ${args.json}`);
}

if (args.text) {
  await mkdir(dirname(args.text), { recursive: true });
  await writeFile(args.text, `${text}\n`, "utf8");
  console.log(`Wrote text diagnostics: ${args.text}`);
}
