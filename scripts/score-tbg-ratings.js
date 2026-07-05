import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { featuresFor, tbgRatingBand, tbgV2Adjustments } from "../src/ratingModel/registrySmwModel.js";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 4) {
  return Number(Number(value ?? 0).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  if (/[,"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function positionGroup(position) {
  const value = String(position ?? "").toLowerCase();
  if (value.includes("gk") || value.includes("goalkeeper")) return "GK";
  if (value.startsWith("d") || value.includes("back") || value.includes("defender")) return "DEF";
  if (value.startsWith("m") || value.includes("midfield")) return "MID";
  if (value.startsWith("f") || value.startsWith("am") || value.includes("wing") || value.includes("forward") || value.includes("striker")) return "ATT";
  return "UNK";
}

function predict(features, coefficients, featureNames) {
  return featureNames.reduce((sum, name) => sum + number(features[name]) * number(coefficients[name]), 0);
}

function byTransfermarktId(rows) {
  return new Map(rows.filter((row) => row.transfermarkt_id).map((row) => [String(row.transfermarkt_id), row]));
}

function blankRegistryRowFromTransfermarkt(tmRow) {
  return {
    tbg_player_id: tmRow.tbg_player_id || `tbg-tm-${String(tmRow.transfermarkt_id || tmRow.player_id || "").padStart(8, "0")}`,
    transfermarkt_id: String(tmRow.transfermarkt_id || tmRow.player_id || ""),
    canonical_name: tmRow.display_name || tmRow.full_name || "",
    display_name: tmRow.display_name || tmRow.full_name || "",
    full_name: tmRow.full_name || tmRow.display_name || "",
    primary_position: tmRow.position || "",
    position_category: tmRow.position_category || "",
    current_club: tmRow.current_club || "",
    current_competition_code: tmRow.current_competition_code || "",
    soccerwiki_rating: ""
  };
}

function scoreRow(model, registryRow, tmRow) {
  const features = featuresFor(registryRow, tmRow);
  const smwEquivalentRaw = clamp(predict(features, model.coefficients, model.featureNames), 60, 99);
  const smwEquivalentRating = Math.round(smwEquivalentRaw);
  const example = {
    age: number(tmRow.age, 0),
    marketValueEur: number(tmRow.market_value_eur, 0),
    highestMarketValueEur: number(tmRow.highest_market_value_eur, 0),
    previousMarketValueEur: number(tmRow.previous_market_value_eur, 0),
    internationalCaps: number(tmRow.international_caps, 0),
    internationalGoals: number(tmRow.international_goals, 0),
    totalTransferFeesEur: number(tmRow.total_transfer_fees_eur, 0),
    currentClub: registryRow.current_club || tmRow.current_club,
    clubName: registryRow.current_club || tmRow.current_club,
    currentCompetitionCode: registryRow.current_competition_code || tmRow.current_competition_code,
    competitionCode: registryRow.current_competition_code || tmRow.current_competition_code,
    positionGroup: positionGroup(tmRow.position || registryRow.primary_position)
  };
  const tbgV2 = tbgV2Adjustments(example, smwEquivalentRaw);
  const tbgRatingRaw = clamp(smwEquivalentRaw + tbgV2.total, 60, 99);
  const tbgRating = Math.round(tbgRatingRaw);
  const smwRating = number(registryRow.soccerwiki_rating, 0) || "";
  return {
    tbgPlayerId: registryRow.tbg_player_id || blankRegistryRowFromTransfermarkt(tmRow).tbg_player_id,
    transfermarktId: String(tmRow.transfermarkt_id || registryRow.transfermarkt_id || ""),
    soccerwikiId: registryRow.soccerwiki_id || "",
    playerName: registryRow.soccerwiki_name || registryRow.canonical_name || tmRow.display_name || tmRow.full_name,
    transfermarktName: tmRow.display_name || tmRow.full_name,
    clubName: registryRow.current_club || tmRow.current_club,
    currentCompetitionCode: example.currentCompetitionCode,
    position: registryRow.primary_position || tmRow.position,
    positionGroup: example.positionGroup,
    age: example.age,
    marketValueEur: example.marketValueEur,
    highestMarketValueEur: example.highestMarketValueEur,
    previousMarketValueEur: example.previousMarketValueEur,
    internationalCaps: example.internationalCaps,
    internationalGoals: example.internationalGoals,
    totalTransferFeesEur: example.totalTransferFeesEur,
    smwRating,
    smwEquivalentRaw: round(smwEquivalentRaw, 2),
    smwEquivalentRating,
    abilityComponent: tbgV2.ability,
    prestigeComponent: tbgV2.prestige,
    trajectoryComponent: tbgV2.trajectory,
    tbgV2Adjustment: tbgV2.total,
    tbgV2AdjustmentReasons: tbgV2.reasons,
    tbgRatingRaw: round(tbgRatingRaw, 2),
    tbgRating,
    tbgRatingBand: tbgRatingBand(tbgRating),
    tbgDeltaRounded: smwRating ? tbgRating - smwRating : ""
  };
}

function csv(rows) {
  const headers = [
    "tbgPlayerId",
    "transfermarktId",
    "soccerwikiId",
    "playerName",
    "transfermarktName",
    "clubName",
    "currentCompetitionCode",
    "position",
    "positionGroup",
    "age",
    "marketValueEur",
    "highestMarketValueEur",
    "previousMarketValueEur",
    "internationalCaps",
    "internationalGoals",
    "totalTransferFeesEur",
    "smwRating",
    "smwEquivalentRaw",
    "smwEquivalentRating",
    "abilityComponent",
    "prestigeComponent",
    "trajectoryComponent",
    "tbgV2Adjustment",
    "tbgV2AdjustmentReasons",
    "tbgRatingRaw",
    "tbgRating",
    "tbgRatingBand",
    "tbgDeltaRounded"
  ];
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n";
}

function markdown(rows) {
  const lines = [
    "# TBG Rating Scores",
    "",
    "These scores apply the trained SMW-equivalent model and TBG v2 ability/prestige/trajectory adjustments to any Transfermarkt player in the master database.",
    "",
    "Player | Club | Comp | Pos | Age | SMW Eq | TBG | Band | Adjustment | Reasons",
    "--- | --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---"
  ];
  for (const row of rows.slice(0, 100)) {
    lines.push(`${row.playerName} | ${row.clubName} | ${row.currentCompetitionCode} | ${row.positionGroup} | ${row.age} | ${row.smwEquivalentRating} | ${row.tbgRating} | ${row.tbgRatingBand} | ${row.tbgV2Adjustment} | ${row.tbgV2AdjustmentReasons.join("; ")}`);
  }
  return lines.join("\n") + "\n";
}

const args = parseArgs(process.argv.slice(2));
const modelPath = args.model ?? "calibration/registry-smw-rating-model.json";
const registryPath = args.registry ?? "data/players/player-registry.json";
const transfermarktPath = args.transfermarkt ?? "data/transfermarkt/players-master.json";
const outputPath = args.output ?? "calibration/tbg-rating-scores.csv";
const reportPath = args.report ?? "calibration/tbg-rating-scores.md";
const onlyTransfermarktIds = String(args.transfermarktIds ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const onlyNames = String(args.names ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);

const model = JSON.parse(await readFile(modelPath, "utf8"));
const registryRows = JSON.parse(await readFile(registryPath, "utf8"));
const transfermarktRows = JSON.parse(await readFile(transfermarktPath, "utf8"));
const registryByTmId = byTransfermarktId(registryRows);

let rows = transfermarktRows
  .filter((tmRow) => tmRow.transfermarkt_id || tmRow.player_id)
  .map((tmRow) => scoreRow(model, registryByTmId.get(String(tmRow.transfermarkt_id || tmRow.player_id)) || blankRegistryRowFromTransfermarkt(tmRow), tmRow));

if (onlyTransfermarktIds.length) rows = rows.filter((row) => onlyTransfermarktIds.includes(String(row.transfermarktId)));
if (onlyNames.length) rows = rows.filter((row) => onlyNames.some((name) => String(row.playerName).toLowerCase().includes(name) || String(row.transfermarktName).toLowerCase().includes(name)));

rows.sort((a, b) => b.tbgRatingRaw - a.tbgRatingRaw || b.smwEquivalentRaw - a.smwEquivalentRaw || String(a.playerName).localeCompare(String(b.playerName)));

for (const path of [outputPath, reportPath]) await mkdir(dirname(path), { recursive: true });
await writeFile(outputPath, csv(rows), "utf8");
await writeFile(reportPath, markdown(rows), "utf8");

console.log(`Scored ${rows.length} player(s).`);
console.log(`Wrote TBG scores CSV: ${outputPath}`);
console.log(`Wrote TBG scores report: ${reportPath}`);
if (rows.length) console.table(rows.slice(0, 20).map((row) => ({ player: row.playerName, club: row.clubName, comp: row.currentCompetitionCode, smwEq: row.smwEquivalentRating, tbg: row.tbgRating, adjustment: row.tbgV2Adjustment })));
