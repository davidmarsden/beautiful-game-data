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
    .replace(/[’']/g, "")
    .replace(/[ø]/g, "o")
    .replace(/[Ø]/g, "o")
    .replace(/[æ]/g, "ae")
    .replace(/[Æ]/g, "ae")
    .replace(/[ß]/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MANUAL_ALIASES = new Map([
  ["alisson", ["becker alisson", "alisson becker"]],
  ["casemiro", ["carlos casemiro", "casemiro carlos"]],
  ["cristiano ronaldo", ["cristiano ronaldo dos santos aveiro"]],
  ["pedri", ["pedro gonzalez lopez", "pedro gonzalez"]],
  ["rodri", ["hernandez rodri", "rodrigo hernandez", "rodrigo hernandez cascante"]],
  ["vinicius junior", ["vinicius jose paixao de oliveira junior", "vinicius jr"]],
  ["lamine yamal", ["lamine yamal nasraoui ebana"]],
  ["raphinha", ["raphael dias belloli"]],
  ["joao pedro", ["joao pedro junqueira de jesus"]],
  ["nico williams", ["nicholas williams arthuer"]],
  ["marc andre ter stegen", ["marc andre ter stegen"]]
]);

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

function candidateNames(row) {
  return [
    row.name,
    row.playerName,
    row.transfermarktName,
    row.display_name,
    row.full_name,
    row.short_name,
    row.nickname,
    row.name_key,
    row.full_name_key
  ]
    .map((value) => String(value ?? ""))
    .filter(Boolean);
}

function tokenSet(value) {
  return new Set(normalise(value).split(" ").filter(Boolean));
}

function overlapScore(targetName, candidateName) {
  const targetTokens = tokenSet(targetName);
  const candidateTokens = tokenSet(candidateName);
  if (!targetTokens.size || !candidateTokens.size) return 0;
  let overlap = 0;
  for (const token of targetTokens) if (candidateTokens.has(token)) overlap += 1;
  const targetCoverage = overlap / targetTokens.size;
  const candidateCoverage = overlap / candidateTokens.size;
  return Math.max(targetCoverage, candidateCoverage * 0.8);
}

function aliasKeys(name) {
  const key = normalise(name);
  return [key, ...(MANUAL_ALIASES.get(key) ?? []).map(normalise)];
}

function findTransfermarktIdentity(target, transfermarktRows) {
  const keys = aliasKeys(target.name);
  const exact = transfermarktRows.find((row) => {
    const names = candidateNames(row).map(normalise);
    return keys.some((key) => names.includes(key));
  });
  if (exact) return { row: exact, matchMethod: "transfermarkt_exact_or_alias" };

  const scored = transfermarktRows
    .map((row) => {
      const score = Math.max(...candidateNames(row).map((name) => overlapScore(target.name, name)), 0);
      return { row, score };
    })
    .filter((item) => item.score >= 0.95)
    .sort((a, b) => b.score - a.score || number(b.row.market_value_eur) - number(a.row.market_value_eur));

  if (scored[0]) return { row: scored[0].row, matchMethod: "transfermarkt_token_match" };
  return { row: null, matchMethod: "unresolved" };
}

function buildScoreIndexes(scores) {
  const byTransfermarktId = new Map();
  for (const row of scores) {
    const id = String(row.transfermarktId || row.transfermarkt_id || "").trim();
    if (id && !byTransfermarktId.has(id)) byTransfermarktId.set(id, row);
  }
  return { byTransfermarktId };
}

function findScoreByName(target, scores) {
  const keys = aliasKeys(target.name);
  return scores.find((row) => keys.some((key) => candidateNames(row).map(normalise).includes(key)))
    || scores.find((row) => keys.some((key) => candidateNames(row).some((name) => normalise(name).includes(key) || key.includes(normalise(name)))))
    || scores
      .map((row) => ({ row, score: Math.max(...candidateNames(row).map((name) => overlapScore(target.name, name)), 0) }))
      .filter((item) => item.score >= 0.95)
      .sort((a, b) => b.score - a.score || number(b.row.marketValueEur) - number(a.row.marketValueEur))[0]?.row;
}

function resolveScore(target, scores, scoreIndexes, transfermarktRows) {
  const identity = findTransfermarktIdentity(target, transfermarktRows);
  const transfermarktId = String(identity.row?.transfermarkt_id || identity.row?.player_id || "").trim();
  if (transfermarktId && scoreIndexes.byTransfermarktId.has(transfermarktId)) {
    return { score: scoreIndexes.byTransfermarktId.get(transfermarktId), matchMethod: identity.matchMethod, transfermarktId };
  }
  const fallback = findScoreByName(target, scores);
  return {
    score: fallback,
    matchMethod: fallback ? "score_name_fallback" : identity.matchMethod,
    transfermarktId: transfermarktId || String(fallback?.transfermarktId || fallback?.transfermarkt_id || "")
  };
}

const args = parseArgs(process.argv.slice(2));
const calibrationSetPath = args.set ?? "data/calibration/tbg-gold-standard-players.json";
const scoresPath = args.scores ?? "calibration/tbg-gold-standard-ratings.csv";
const transfermarktPath = args.transfermarkt ?? "data/transfermarkt/players-master.json";
const outputPath = args.output ?? "calibration/tbg-gold-standard-review.md";
const csvOutputPath = args.csv ?? "calibration/tbg-gold-standard-review.csv";

const calibrationSet = JSON.parse(await readFile(calibrationSetPath, "utf8"));
const scores = parseCsv(await readFile(scoresPath, "utf8"));
const transfermarktRows = JSON.parse(await readFile(transfermarktPath, "utf8"));
const scoreIndexes = buildScoreIndexes(scores);

const reviewRows = calibrationSet.map((target) => {
  const resolved = resolveScore(target, scores, scoreIndexes, transfermarktRows);
  const score = resolved.score;
  const tbgRating = number(score?.tbgRating, 0);
  const status = verdict(tbgRating, target.expectedMin, target.expectedMax);
  return {
    name: target.name,
    category: target.category,
    expectedMin: target.expectedMin,
    expectedMax: target.expectedMax,
    matchedName: score?.playerName ?? score?.transfermarktName ?? "",
    transfermarktId: resolved.transfermarktId,
    matchMethod: resolved.matchMethod,
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

lines.push("", "## Players needing review", "", "Player | Category | Expected | Matched | TM ID | Match | Club | SMW Eq | TBG | Verdict | Reasons", "--- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | ---");
for (const row of reviewRows.filter((item) => item.verdict !== "ok")) {
  lines.push(`${row.name} | ${row.category} | ${row.expectedMin}-${row.expectedMax} | ${row.matchedName} | ${row.transfermarktId} | ${row.matchMethod} | ${row.clubName} | ${row.smwEquivalentRating} | ${row.tbgRating} | ${row.verdict} | ${row.reasons}`);
}

lines.push("", "## Full review", "", "Player | Category | Expected | Matched | TM ID | Match | Club | SMW Eq | TBG | Verdict", "--- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---");
for (const row of reviewRows) {
  lines.push(`${row.name} | ${row.category} | ${row.expectedMin}-${row.expectedMax} | ${row.matchedName} | ${row.transfermarktId} | ${row.matchMethod} | ${row.clubName} | ${row.smwEquivalentRating} | ${row.tbgRating} | ${row.verdict}`);
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
