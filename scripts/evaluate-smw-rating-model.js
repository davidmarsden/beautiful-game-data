import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { evaluateSmwRatingModel, formatSmwRatingEvaluationReport } from "../src/ratingModel/evaluateSmwModel.js";
import { trainSmwRatingModel } from "../src/ratingModel/trainSmwModel.js";

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

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadRows(path) {
  const text = await readFile(path, "utf8");
  return path.endsWith(".json") ? JSON.parse(text) : parseCsv(text);
}

const args = parseArgs(process.argv.slice(2));

if (!args.pack || !args.targets) {
  console.error("Usage: node scripts/evaluate-smw-rating-model.js --pack=<league-pack.json> --targets=<smw-ratings.csv> [--marketValues=calibration/transfermarkt-values.csv] [--output=calibration/smw-rating-evaluation.json]");
  process.exit(1);
}

const output = args.output ?? "calibration/smw-rating-evaluation.json";
const report = args.report ?? output.replace(/\.json$/i, ".md");
const pack = await loadJson(args.pack);
const targets = await loadRows(args.targets);
const marketValueRows = args.marketValues && await exists(args.marketValues) ? await loadRows(args.marketValues) : [];
if (args.marketValues && !marketValueRows.length) console.warn(`No Transfermarkt market values loaded from ${args.marketValues}`);

const model = trainSmwRatingModel(pack, targets, {
  ridge: args.ridge ? Number(args.ridge) : 1,
  calibrationRidge: args.calibrationRidge ? Number(args.calibrationRidge) : 0.5,
  minTrainingConfidence: args.minTrainingConfidence ? Number(args.minTrainingConfidence) : 0.95,
  excludeClubMismatches: args.excludeClubMismatches === "true",
  marketValueRows
});
const evaluation = evaluateSmwRatingModel(model, {
  biggestMissLimit: args.biggestMissLimit ? Number(args.biggestMissLimit) : 25
});

const text = formatSmwRatingEvaluationReport(evaluation);
console.log(text);

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ model, evaluation }, null, 2)}\n`, "utf8");
await writeFile(report, `${text}\n`, "utf8");
console.log(`\nWrote SMW rating evaluation: ${output}`);
console.log(`Wrote SMW rating evaluation report: ${report}`);
