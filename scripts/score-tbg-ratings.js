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
  const text = Array.isArray(value) ? value.join(" | ") : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
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

function componentReasonMatch(reason) {
  const text = String(reason ?? "").toLowerCase();
  if (text.includes("trajectory")) return "elite_trajectory_adjustment";
  if (text.includes("form is temporary") || text.includes("class is permanent") || text.includes("class inertia")) return "class_retention_adjustment";
  if (text.includes("international") || text.includes("centurion") || text.includes("transfer-fee") || text.includes("prestige")) return "prestige_adjustment";
  if (text.includes("caution") || text.includes("reality check")) return "current_ability_caution";
  return "other_adjustment";
}

function groupedReasons(reasons) {
  return reasons.reduce((memo, reason) => {
    const key = componentReasonMatch(reason);
    memo[key].push(reason);
    return memo;
  }, {
    elite_trajectory_adjustment: [],
    class_retention_adjustment: [],
    prestige_adjustment: [],
    current_ability_caution: [],
    other_adjustment: []
  });
}

function defaultCurrentState() {
  return {
    form_modifier: 0,
    fitness_modifier: 0,
    match_sharpness_modifier: 0,
    morale_modifier: 0,
    fatigue_modifier: 0,
    tactical_fit_modifier: 0,
    availability_modifier: 0,
    total_modifier: 0,
    note: "Neutral default. Match engine owns fluid state before each fixture."
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
  const abilityRatingRaw = clamp(smwEquivalentRaw + tbgV2.total, 60, 99);
  const abilityRating = Math.round(abilityRatingRaw);
  const currentState = defaultCurrentState();
  const effectiveMatchRatingRaw = clamp(abilityRatingRaw + currentState.total_modifier, 40, 99);
  const effectiveMatchRating = Math.round(effectiveMatchRatingRaw);
  const smwRating = number(registryRow.soccerwiki_rating, 0) || "";
  const reasonsByComponent = groupedReasons(tbgV2.reasons);
  const abilityProfile = {
    model_version: "tbg-v3-sticky-ability-fluid-form",
    philosophy: "Ability is sticky; form, fitness, sharpness, morale, fatigue and tactical fit are fluid match-engine state.",
    base_smw_equivalent_raw: round(smwEquivalentRaw, 2),
    base_smw_equivalent_rating: smwEquivalentRating,
    ability_component: round(tbgV2.ability, 2),
    prestige_component: round(tbgV2.prestige, 2),
    elite_trajectory_component: round(tbgV2.trajectory, 2),
    total_sticky_adjustment: round(tbgV2.total, 2),
    underlying_ability_raw: round(abilityRatingRaw, 2),
    underlying_ability_rating: abilityRating,
    explanation: {
      market_value_eur: example.marketValueEur,
      highest_market_value_eur: example.highestMarketValueEur,
      previous_market_value_eur: example.previousMarketValueEur,
      international_caps: example.internationalCaps,
      international_goals: example.internationalGoals,
      total_transfer_fees_eur: example.totalTransferFeesEur,
      age: example.age,
      reasons: tbgV2.reasons,
      reasons_by_component: reasonsByComponent
    }
  };
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
    abilityComponent: abilityProfile.ability_component,
    prestigeComponent: abilityProfile.prestige_component,
    trajectoryComponent: abilityProfile.elite_trajectory_component,
    eliteTrajectoryComponent: abilityProfile.elite_trajectory_component,
    classRetentionReasons: reasonsByComponent.class_retention_adjustment,
    tbgV2Adjustment: abilityProfile.total_sticky_adjustment,
    tbgV2AdjustmentReasons: tbgV2.reasons,
    tbgRatingRaw: abilityProfile.underlying_ability_raw,
    tbgRating: abilityRating,
    underlyingAbilityRaw: abilityProfile.underlying_ability_raw,
    underlyingAbilityRating: abilityRating,
    currentFormModifier: currentState.form_modifier,
    fitnessModifier: currentState.fitness_modifier,
    matchSharpnessModifier: currentState.match_sharpness_modifier,
    moraleModifier: currentState.morale_modifier,
    fatigueModifier: currentState.fatigue_modifier,
    tacticalFitModifier: currentState.tactical_fit_modifier,
    availabilityModifier: currentState.availability_modifier,
    currentStateTotalModifier: currentState.total_modifier,
    effectiveMatchRatingRaw: round(effectiveMatchRatingRaw, 2),
    effectiveMatchRating,
    tbgRatingBand: tbgRatingBand(abilityRating),
    tbgDeltaRounded: smwRating ? abilityRating - smwRating : "",
    abilityProfile,
    currentState,
    engineProfile: {
      underlying_ability_rating: abilityRating,
      current_state: currentState,
      effective_match_rating: effectiveMatchRating,
      engine_note: "Data repo supplies neutral state. Match engine should replace current_state per fixture."
    }
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
    "eliteTrajectoryComponent",
    "tbgV2Adjustment",
    "tbgV2AdjustmentReasons",
    "underlyingAbilityRaw",
    "underlyingAbilityRating",
    "currentFormModifier",
    "fitnessModifier",
    "matchSharpnessModifier",
    "moraleModifier",
    "fatigueModifier",
    "tacticalFitModifier",
    "availabilityModifier",
    "currentStateTotalModifier",
    "effectiveMatchRatingRaw",
    "effectiveMatchRating",
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
    "These scores apply the trained SMW-equivalent model and TBG v3 sticky-ability / fluid-form architecture to any Transfermarkt player in the master database.",
    "",
    "Player | Club | Comp | Pos | Age | SMW Eq | Ability | Effective | Band | Sticky Adj | Reasons",
    "--- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---"
  ];
  for (const row of rows.slice(0, 100)) {
    lines.push(`${row.playerName} | ${row.clubName} | ${row.currentCompetitionCode} | ${row.positionGroup} | ${row.age} | ${row.smwEquivalentRating} | ${row.underlyingAbilityRating} | ${row.effectiveMatchRating} | ${row.tbgRatingBand} | ${row.tbgV2Adjustment} | ${row.tbgV2AdjustmentReasons.join("; ")}`);
  }
  return lines.join("\n") + "\n";
}

function jsonProfiles(rows) {
  return rows.map((row) => ({
    tbg_player_id: row.tbgPlayerId,
    transfermarkt_id: row.transfermarktId,
    player_name: row.playerName,
    transfermarkt_name: row.transfermarktName,
    club_name: row.clubName,
    current_competition_code: row.currentCompetitionCode,
    position: row.position,
    position_group: row.positionGroup,
    age: row.age,
    ability: row.abilityProfile,
    current_state: row.currentState,
    engine: row.engineProfile
  }));
}

const args = parseArgs(process.argv.slice(2));
const modelPath = args.model ?? "calibration/registry-smw-rating-model.json";
const registryPath = args.registry ?? "data/players/player-registry.json";
const transfermarktPath = args.transfermarkt ?? "data/transfermarkt/players-master.json";
const outputPath = args.output ?? "calibration/tbg-rating-scores.csv";
const reportPath = args.report ?? "calibration/tbg-rating-scores.md";
const jsonOutputPath = args.json ?? "calibration/tbg-rating-profiles.json";
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

for (const path of [outputPath, reportPath, jsonOutputPath]) await mkdir(dirname(path), { recursive: true });
await writeFile(outputPath, csv(rows), "utf8");
await writeFile(reportPath, markdown(rows), "utf8");
await writeFile(jsonOutputPath, JSON.stringify(jsonProfiles(rows), null, 2) + "\n", "utf8");

console.log(`Scored ${rows.length} player(s).`);
console.log(`Wrote TBG scores CSV: ${outputPath}`);
console.log(`Wrote TBG scores report: ${reportPath}`);
console.log(`Wrote TBG rating profiles JSON: ${jsonOutputPath}`);
if (rows.length) console.table(rows.slice(0, 20).map((row) => ({ player: row.playerName, club: row.clubName, comp: row.currentCompetitionCode, smwEq: row.smwEquivalentRating, ability: row.underlyingAbilityRating, effective: row.effectiveMatchRating, adjustment: row.tbgV2Adjustment })));
