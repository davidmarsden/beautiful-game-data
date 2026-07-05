import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { formatRegistrySmwModelReport, trainRegistrySmwRatingModel } from "../src/ratingModel/registrySmwModel.js";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  if (/[,"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function predictionsCsv(rows) {
  const headers = [
    "tbgPlayerId",
    "transfermarktId",
    "soccerwikiId",
    "playerName",
    "clubName",
    "positionGroup",
    "age",
    "marketValueEur",
    "highestMarketValueEur",
    "previousMarketValueEur",
    "targetRating",
    "smwEquivalentRaw",
    "smwEquivalentRating",
    "tbgV2Adjustment",
    "tbgV2AdjustmentReasons",
    "tbgRatingRaw",
    "tbgRating",
    "tbgRatingBand",
    "smwDeltaRounded",
    "tbgDeltaRounded",
    "error",
    "absoluteError",
    "disagreementType",
    "disagreementNote"
  ];
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n";
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const args = parseArgs(process.argv.slice(2));
const registryPath = args.registry ?? "data/players/player-registry.json";
const transfermarktPath = args.transfermarkt ?? "data/transfermarkt/players-master.json";
const outputPath = args.output ?? "calibration/registry-smw-rating-model.json";
const reportPath = args.report ?? "calibration/registry-smw-rating-model.md";
const predictionsPath = args.predictions ?? "calibration/registry-smw-rating-predictions.csv";

const registryRows = await loadJson(registryPath);
const transfermarktRows = await loadJson(transfermarktPath);
const model = trainRegistrySmwRatingModel(registryRows, transfermarktRows, {
  ridge: args.ridge ? Number(args.ridge) : 10,
  includeOutOfScope: args.includeOutOfScope === "true"
});

const report = formatRegistrySmwModelReport(model);
console.log(report);

for (const path of [outputPath, reportPath, predictionsPath]) await mkdir(dirname(path), { recursive: true });
await writeFile(outputPath, JSON.stringify(model, null, 2) + "\n", "utf8");
await writeFile(reportPath, report + "\n", "utf8");
await writeFile(predictionsPath, predictionsCsv(model.predictions), "utf8");

console.log(`\nWrote registry-first SMW model: ${outputPath}`);
console.log(`Wrote model report: ${reportPath}`);
console.log(`Wrote predictions CSV: ${predictionsPath}`);
