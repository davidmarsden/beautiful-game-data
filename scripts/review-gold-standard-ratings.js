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

function normalise(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...body] = rows.filter((item) => item.length > 1);
  return body.map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index] ?? ""])));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function verdict(score, min, max) {
  if (!score) return "missing";
  if (score < min) return "low";
  if (score > max) return "high";
  return "ok";
}

function findScore(target, scores) {
  const targetName = normalise(target.name);
  return scores.find((row) => normalise(row.playerName) === targetName)
    || scores.find((row) => normalise(row.transfermarktName) === targetName)
    || scores.find((row) => normalise(row.playerName).includes(targetName) || targetName.includes(normalise(row.playerName)))
    || scores.find((row) => normalise(row.transfermarktName).includes(targetName) || targetName.includes(normalise(row.transfermarktName)));
}

const args = parseArgs(process.argv.slice(2));
const calibrationSetPath = args.set ?? "data/calibration/tbg-gold-standard-players.json";
const scoresPath = args.scores ?? "calibration/tbg-gold-standard-ratings.csv";
const outputPath = args.output ?? "calibration/tbg-gold-standard-review.md";
const csvOutputPath = args.csv ?? "calibration/tbg-gold-standard-review.csv";

const calibrationSet = JSON.parse(await readFile(calibrationSetPath, "utf8"));
const scores = parseCsv(await readFile(scoresPath, "utf8"));
const reviewRows = calibrationSet.map((target) => {
  const score = findScore(target, scores);
  const tbgRating = number(score?.tbgRating, 0);
  const status = verdict(tbgRating, target.expectedMin, target.expectedMax);
  return {
    name: target.name,
    category: target.category,
    expectedMin: target.expectedMin,
    expectedMax: target.expectedMax,
    matchedName: score?.playerName ?? "",
    clubName: score?.clubName ?? "",
    positionGroup: score?.positionGroup ?? target.positionGroup ?? "",
    smwEquivalentRating: score?.smwEquivalentRating ?? "",
    tbgRating: tbgRating || "",
    tbgV2Adjustment: score?.tbgV2Adjustment ?? "",
    verdict: status,
    reasons: score?.tbgV2AdjustmentReasons ?? ""
  };
});

const summary = reviewRows.reduce((acc, row) => {
  acc[row.verdict] = (acc[row.verdict] ?? 0) + 1;
  return acc;
}, {});
const byCategory = reviewRows.reduce((acc, row) => {
  if (!acc[row.category]) acc[row.category] = { ok: 0, low: 0, high: 0, missing: 0, total: 0 };
  acc[row.category][row.verdict] += 1;
  acc[row.category].total += 1;
  return acc;
}, {});

const lines = [
  "# TBG Gold-Standard Rating Review",
  "",
  `Players in set: ${reviewRows.length}`,
  `Matched and in expected band: ${summary.ok ?? 0}`,
  `Too low: ${summary.low ?? 0}`,
  `Too high: ${summary.high ?? 0}`,
  `Missing: ${summary.missing ?? 0}`,
  "",
  "## By category",
  "",
  "Category | Total | OK | Low | High | Missing",
  "--- | ---: | ---: | ---: | ---: | ---:"
];

for (const [category, stats] of Object.entries(byCategory).sort()) {
  lines.push(`${category} | ${stats.total} | ${stats.ok} | ${stats.low} | ${stats.high} | ${stats.missing}`);
}

lines.push("", "## Players needing review", "", "Player | Category | Expected | Matched | Club | SMW Eq | TBG | Verdict | Reasons", "--- | --- | --- | --- | --- | ---: | ---: | --- | ---");
for (const row of reviewRows.filter((item) => item.verdict !== "ok")) {
  lines.push(`${row.name} | ${row.category} | ${row.expectedMin}-${row.expectedMax} | ${row.matchedName} | ${row.clubName} | ${row.smwEquivalentRating} | ${row.tbgRating} | ${row.verdict} | ${row.reasons}`);
}

lines.push("", "## Full review", "", "Player | Category | Expected | Matched | Club | SMW Eq | TBG | Verdict", "--- | --- | --- | --- | --- | ---: | ---: | ---");
for (const row of reviewRows) {
  lines.push(`${row.name} | ${row.category} | ${row.expectedMin}-${row.expectedMax} | ${row.matchedName} | ${row.clubName} | ${row.smwEquivalentRating} | ${row.tbgRating} | ${row.verdict}`);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[,"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

const headers = Object.keys(reviewRows[0] ?? {});
const csv = [headers.join(","), ...reviewRows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n";

for (const path of [outputPath, csvOutputPath]) await mkdir(dirname(path), { recursive: true });
await writeFile(outputPath, lines.join("\n") + "\n", "utf8");
await writeFile(csvOutputPath, csv, "utf8");

console.log(JSON.stringify({ summary, byCategory }, null, 2));
console.log(`Wrote gold-standard review: ${outputPath}`);
console.log(`Wrote gold-standard review CSV: ${csvOutputPath}`);
