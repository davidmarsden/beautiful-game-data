import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [headers, ...body] = rows.filter((item) => item.length > 1);
  if (!headers) return { headers: [], records: [] };
  return { headers, records: body.map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index] ?? ""]))) };
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(" | ") : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
  return /[,"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(headers, rows) {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n";
}

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const text = (value) => String(value ?? "").trim();

function ageBand(age) {
  if (age >= 40) return "age_40_plus";
  if (age >= 37) return "age_37_39";
  return "age_34_36";
}

function isEliteLeague(code, policy) {
  return policy.elite_league_codes.some((item) => text(code).toUpperCase().includes(text(item).toUpperCase()));
}

function unlinkedPenalty(row, policy) {
  const age = number(row.age);
  const elite = isEliteLeague(row.currentCompetitionCode, policy);
  const goalkeeper = row.positionGroup === "GK";
  const value = number(row.marketValueEur);
  const rules = policy.unlinked_penalties;
  if (age >= 40) {
    if (elite) return goalkeeper ? rules.age_40_plus_elite_gk : rules.age_40_plus_elite_outfield;
    return goalkeeper ? rules.age_40_plus_non_elite_gk : rules.age_40_plus_non_elite_outfield;
  }
  if (age >= 37) return elite ? rules.age_37_39_elite : rules.age_37_39_non_elite;
  if (!elite && value < policy.low_market_value_eur) return rules.age_34_36_non_elite_low_value;
  return 0;
}

function applyRealityCheck(row, policy) {
  const age = number(row.age);
  const before = number(row.underlyingAbilityRating || row.tbgRating);
  if (age < policy.minimum_age || before < policy.review_rating_floor) return null;
  if (policy.protected_transfermarkt_ids.includes(text(row.transfermarktId))) return null;

  const smw = number(row.smwRating, 0);
  const goalkeeper = row.positionGroup === "GK";
  const elite = isEliteLeague(row.currentCompetitionCode, policy);
  let after = before;
  let reason = "";

  if (smw > 0) {
    const allowance = policy.maximum_positive_gap_over_soccerwiki[ageBand(age)][goalkeeper ? "GK" : "outfield"];
    const maximum = smw + allowance;
    if (before > maximum) {
      const midpoint = Math.round((before + smw) / 2);
      after = Math.min(maximum, midpoint);
      reason = `linked veteran cap: TBG ${before}, SoccerWiki ${smw}, permitted gap +${allowance}`;
    }
  } else {
    const penalty = unlinkedPenalty(row, policy);
    if (penalty > 0) {
      after = before - penalty;
      reason = `unlinked veteran caution: age ${age}, ${elite ? "elite" : "non-elite"} league, ${goalkeeper ? "GK" : "outfield"}`;
    }
  }

  after = clamp(Math.round(after), 60, 99);
  if (after >= before) return null;
  return { before, after, adjustment: after - before, reason, soccerwiki_rating: smw || null, elite_league: elite };
}

const configPath = process.argv[2] || "data/config/veteran-rating-policy.json";
const scoresPath = "calibration/tbg-rating-scores.csv";
const profilesPath = "calibration/tbg-rating-profiles.json";
const reportJsonPath = "calibration/veteran-reality-check.json";
const reportMarkdownPath = "calibration/veteran-reality-check.md";

const [policy, csvInput, profiles] = await Promise.all([
  readFile(configPath, "utf8").then(JSON.parse),
  readFile(scoresPath, "utf8"),
  readFile(profilesPath, "utf8").then(JSON.parse)
]);

const { headers, records } = parseCsv(csvInput);
const adjustments = [];
const adjustedById = new Map();

for (const row of records) {
  const result = applyRealityCheck(row, policy);
  if (!result) continue;
  const id = text(row.transfermarktId);
  const oldRaw = number(row.underlyingAbilityRaw || row.tbgRatingRaw || result.before);
  const delta = result.after - result.before;
  row.underlyingAbilityRating = result.after;
  row.tbgRating = result.after;
  row.effectiveMatchRating = result.after;
  row.underlyingAbilityRaw = round(oldRaw + delta);
  row.tbgRatingRaw = round(number(row.tbgRatingRaw, oldRaw) + delta);
  row.effectiveMatchRatingRaw = round(number(row.effectiveMatchRatingRaw, oldRaw) + delta);
  row.tbgRatingBand = result.after >= 94 ? "world_elite" : result.after >= 91 ? "elite" : result.after >= 89 ? "top_tier" : result.after >= 87 ? "first_team" : result.after >= 84 ? "senior_squad" : "development";
  row.tbgDeltaRounded = row.smwRating ? result.after - number(row.smwRating) : "";
  adjustedById.set(id, result.after);
  adjustments.push({
    transfermarkt_id: id,
    player_name: row.playerName,
    club: row.clubName,
    competition: row.currentCompetitionCode,
    position_group: row.positionGroup,
    age: number(row.age),
    market_value_eur: number(row.marketValueEur),
    ...result
  });
}

for (const profile of profiles) {
  const adjusted = adjustedById.get(text(profile.transfermarkt_id));
  if (!adjusted) continue;
  if (profile.ability) {
    profile.ability.underlying_ability_rating = adjusted;
    profile.ability.underlying_ability_raw = adjusted;
    profile.ability.veteran_reality_check = true;
  }
  if (profile.engine) {
    profile.engine.underlying_ability_rating = adjusted;
    profile.engine.effective_match_rating = adjusted;
  }
}

adjustments.sort((a, b) => a.adjustment - b.adjustment || b.before - a.before || a.player_name.localeCompare(b.player_name));
const report = {
  generated_at: new Date().toISOString(),
  policy,
  summary: {
    veteran_rows_reviewed: records.filter((row) => number(row.age) >= policy.minimum_age && number(row.tbgRating) >= policy.review_rating_floor).length,
    adjusted_players: adjustments.length,
    linked_to_soccerwiki: adjustments.filter((row) => row.soccerwiki_rating).length,
    unlinked: adjustments.filter((row) => !row.soccerwiki_rating).length,
    maximum_reduction: adjustments.length ? Math.min(...adjustments.map((row) => row.adjustment)) : 0
  },
  adjustments
};

const markdown = [
  "# Veteran Reality Check",
  "",
  `Generated: ${report.generated_at}`,
  "",
  `- Adjusted players: ${report.summary.adjusted_players}`,
  `- SoccerWiki-linked adjustments: ${report.summary.linked_to_soccerwiki}`,
  `- Unlinked adjustments: ${report.summary.unlinked}`,
  `- Maximum reduction: ${report.summary.maximum_reduction}`,
  "",
  "## Adjustments",
  "",
  ...adjustments.map((row) => `- ${row.player_name} (${row.age}, ${row.club || "Without Club"}): ${row.before} → ${row.after}${row.soccerwiki_rating ? `; SW ${row.soccerwiki_rating}` : ""} — ${row.reason}`)
].join("\n") + "\n";

for (const path of [scoresPath, profilesPath, reportJsonPath, reportMarkdownPath]) await mkdir(dirname(path), { recursive: true });
await writeFile(scoresPath, writeCsv(headers, records), "utf8");
await writeFile(profilesPath, JSON.stringify(profiles, null, 2) + "\n", "utf8");
await writeFile(reportJsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
await writeFile(reportMarkdownPath, markdown, "utf8");

console.log(JSON.stringify(report.summary, null, 2));
console.log(`Wrote ${reportJsonPath} and ${reportMarkdownPath}`);
