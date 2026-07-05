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

function normaliseText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[ø]/g, "o")
    .replace(/[Ø]/g, "O")
    .replace(/[æ]/g, "ae")
    .replace(/[Æ]/g, "AE")
    .replace(/[ß]/g, "ss")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[,"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(records, headers) {
  return [headers.join(","), ...records.map((record) => headers.map((header) => csvEscape(record[header])).join(","))].join("\n") + "\n";
}

function buildNameTokens(value) {
  return new Set(normaliseText(value).split(" ").filter(Boolean));
}

function tokenOverlapScore(left, right) {
  const leftTokens = buildNameTokens(left);
  const rightTokens = buildNameTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function candidateNames(player) {
  return [player.display_name, player.full_name, player.short_name, player.nickname]
    .map((name) => String(name ?? ""))
    .filter(Boolean);
}

function findBestMatch(targetName, players) {
  const targetKey = normaliseText(targetName);
  const exact = players.find((player) => [player.name_key, player.full_name_key, ...candidateNames(player).map(normaliseText)].includes(targetKey));
  if (exact) return { player: exact, score: 1, matchType: "exact" };

  const scored = players
    .map((player) => {
      const score = Math.max(...candidateNames(player).map((name) => tokenOverlapScore(targetName, name)), 0);
      return { player, score, matchType: score >= 0.75 ? "probable" : score >= 0.5 ? "possible" : "weak" };
    })
    .sort((a, b) => b.score - a.score || Number(b.player.market_value_eur ?? 0) - Number(a.player.market_value_eur ?? 0));

  return scored[0] ?? { player: null, score: 0, matchType: "missing" };
}

const args = parseArgs(process.argv.slice(2));
const goldStandardPath = args.goldStandard ?? "data/calibration/tbg-gold-standard-players.json";
const playersPath = args.players ?? "data/transfermarkt/players-master.json";
const outputPath = args.output ?? "calibration/transfermarkt-gold-standard-coverage.csv";
const summaryPath = args.summary ?? "calibration/transfermarkt-gold-standard-coverage-summary.json";
const missingQueriesPath = args.missingQueries ?? "calibration/transfermarkt-gold-standard-missing-queries.json";

const goldStandard = JSON.parse(await readFile(goldStandardPath, "utf8"));
const players = JSON.parse(await readFile(playersPath, "utf8"));

const rows = goldStandard.map((row) => {
  const match = findBestMatch(row.name, players);
  const player = match.player;
  const covered = match.score >= 0.75;
  return {
    name: row.name,
    category: row.category,
    expected_min: row.expectedMin,
    expected_max: row.expectedMax,
    coverage: covered ? match.matchType : "missing",
    score: match.score.toFixed(2),
    matched_name: covered ? player.display_name : player?.display_name ?? "",
    club: covered ? player.current_club : player?.current_club ?? "",
    competition: covered ? player.current_competition_code : player?.current_competition_code ?? "",
    transfermarkt_id: covered ? player.transfermarkt_id : player?.transfermarkt_id ?? "",
    market_value_eur: covered ? player.market_value_eur : player?.market_value_eur ?? ""
  };
});

const summary = rows.reduce(
  (memo, row) => {
    memo.total += 1;
    memo[row.coverage] = (memo[row.coverage] ?? 0) + 1;
    if (row.coverage === "missing") memo.missing_players.push(row.name);
    return memo;
  },
  { total: 0, exact: 0, probable: 0, missing: 0, missing_players: [] }
);
summary.covered = summary.exact + summary.probable;
summary.coverage_rate = summary.total ? Number((summary.covered / summary.total).toFixed(3)) : 0;

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(summaryPath), { recursive: true });
await mkdir(dirname(missingQueriesPath), { recursive: true });
await writeFile(
  outputPath,
  writeCsv(rows, [
    "name",
    "category",
    "expected_min",
    "expected_max",
    "coverage",
    "score",
    "matched_name",
    "club",
    "competition",
    "transfermarkt_id",
    "market_value_eur"
  ]),
  "utf8"
);
await writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
await writeFile(missingQueriesPath, JSON.stringify(summary.missing_players, null, 2) + "\n", "utf8");

console.log(`Gold-standard players: ${summary.total}`);
console.log(`Covered: ${summary.covered}`);
console.log(`Missing: ${summary.missing}`);
console.log(`Coverage rate: ${(summary.coverage_rate * 100).toFixed(1)}%`);
console.log(`Wrote coverage CSV: ${outputPath}`);
console.log(`Wrote coverage summary: ${summaryPath}`);
console.log(`Wrote missing query list: ${missingQueriesPath}`);
