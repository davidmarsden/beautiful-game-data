// Scores adjudicated gold-standard samples produced by runIdentityBenchmark.
//
//   TM-anchored rows answer DISCOVERY: for a TM player whose SM identity a
//   reviewer has established, was it among the strict candidates? The wide ones?
//   SM-anchored rows answer AUTOMATIC PRECISION: when a linking rule would fire,
//   is the top candidate the identity the reviewer confirmed?
//
// Rows without an adjudication are ignored and counted as pending. SM decisions
// are also run through the decision validator, so contradictory adjudications
// are reported instead of being scored.

import { validateIdentityDecisions } from "../validateIdentityDecisions.js";

function text(value) {
  return String(value ?? "").trim();
}

function ids(value) {
  return new Set(text(value).split(/\s+/).filter(Boolean));
}

function rate(hit, total) {
  return { hit, total, pct: total ? Math.round((hit / total) * 1000) / 10 : null };
}

export function evaluateTmGold(rows) {
  const byStratum = {};
  let pending = 0;
  let unsure = 0;
  for (const row of rows) {
    const status = text(row.truth_status);
    if (!status) { pending += 1; continue; }
    if (status === "unsure") { unsure += 1; continue; }
    const s = (byStratum[row.stratum] ??= { adjudicated: 0, not_in_sm: 0, found: 0, strict: 0, wide: 0, either: 0 });
    s.adjudicated += 1;
    if (status === "not_in_sm") { s.not_in_sm += 1; continue; }
    const truth = text(row.truth_sm_player_data_id);
    if (status !== "found" || !truth) continue;
    s.found += 1;
    const inStrict = ids(row.strict_sm_ids).has(truth);
    const inWide = ids(row.wide_sm_ids).has(truth);
    if (inStrict) s.strict += 1;
    if (inWide) s.wide += 1;
    if (inStrict || inWide) s.either += 1;
  }
  const discovery = Object.fromEntries(Object.entries(byStratum).map(([stratum, s]) => [stratum, {
    adjudicated: s.adjudicated,
    not_in_sm: s.not_in_sm,
    strict_recall: rate(s.strict, s.found),
    wide_recall: rate(s.wide, s.found),
    either_recall: rate(s.either, s.found)
  }]));
  return { pending, unsure, discovery };
}

const RULES = {
  // Would fire in a rule that links when exactly one age-consistent exact-name
  // candidate with matching nationality exists. Hypothetical: not implemented.
  h_age1: row => text(row.h_age1_fires) === "true",
  // Baseline: always take the top strict candidate when one exists.
  top_candidate: row => Boolean(text(row.proposed_transfermarkt_id))
};

export function evaluateSmGold(rows) {
  const adjudicated = rows.filter(row => text(row.status));
  const decisions = adjudicated.map(row => ({
    sm_player_data_id: text(row.sm_player_data_id),
    transfermarkt_id: text(row.transfermarkt_id),
    status: text(row.status),
    reviewer: text(row.reviewer),
    decided_at: text(row.decided_at)
  }));
  const validation = validateIdentityDecisions(decisions);
  const conflicted = new Set([...validation.players].filter(([, p]) => p.outcome === "conflict").map(([sid]) => sid));

  // Truth per SM player: a TM id, "none" (no TM identity), or unknown.
  const truthOf = sid => {
    const p = validation.players.get(sid);
    if (!p || conflicted.has(sid)) return null;
    if (p.outcome === "match") return p.transfermarkt_id;
    if (p.outcome === "no_match") return "none";
    return null;
  };

  const precision = {};
  for (const [name, fires] of Object.entries(RULES)) {
    const byStratum = {};
    for (const row of adjudicated) {
      if (!fires(row)) continue;
      const truth = truthOf(text(row.sm_player_data_id));
      if (truth === null) continue;
      const s = (byStratum[row.stratum] ??= { fired: 0, correct: 0 });
      s.fired += 1;
      if (truth === text(row.proposed_transfermarkt_id)) s.correct += 1;
    }
    precision[name] = Object.fromEntries(Object.entries(byStratum).map(([stratum, s]) => [stratum, rate(s.correct, s.fired)]));
  }

  return {
    pending: rows.length - adjudicated.length,
    adjudicated: adjudicated.length,
    decision_conflicts: [...conflicted],
    precision
  };
}
