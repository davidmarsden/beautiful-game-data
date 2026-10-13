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

const TM_STATUSES = new Set(["found", "not_in_sm", "unsure"]);

export function evaluateTmGold(rows) {
  const byStratum = {};
  let pending = 0;
  let unsure = 0;
  // Unknown statuses and "found" without an SM id are reported, never scored,
  // so a typo or an incomplete row cannot quietly inflate recall.
  const invalid = [];
  for (const row of rows) {
    const status = text(row.truth_status);
    if (!status) { pending += 1; continue; }
    const truth = text(row.truth_sm_player_data_id);
    if (!TM_STATUSES.has(status)) { invalid.push({ transfermarkt_id: text(row.transfermarkt_id), reason: `unknown_status:${status}` }); continue; }
    if (status === "found" && !truth) { invalid.push({ transfermarkt_id: text(row.transfermarkt_id), reason: "found_without_sm_id" }); continue; }
    if (status === "unsure") { unsure += 1; continue; }
    const s = (byStratum[row.stratum] ??= { adjudicated: 0, not_in_sm: 0, found: 0, strict: 0, wide: 0, either: 0 });
    s.adjudicated += 1;
    if (status === "not_in_sm") { s.not_in_sm += 1; continue; }
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
  return { pending, unsure, invalid, discovery };
}

// Each rule returns the TM id it would link, or "" when it does not fire.
const RULES = {
  // Links when exactly one age-consistent exact-name candidate with matching
  // nationality exists. Hypothetical: not implemented in the reconciler.
  h_age1: row => text(row.h_age1_fires) === "true" ? text(row.h_age1_target_transfermarkt_id) : "",
  // Baseline: always take the top-scoring strict candidate.
  top_candidate: row => text(row.proposed_transfermarkt_id)
};

// Verdict on one proposed link, from the validated adjudications:
//   true  - the reviewer confirmed this pair;
//   false - the reviewer confirmed another TM player, said the SM player has
//           no TM identity, or rejected this specific pair;
//   null  - not decidable (unresolved, conflicting, or nothing about this pair).
function verdict(player, tid) {
  if (!player || player.outcome === "conflict") return null;
  if (player.outcome === "match") return player.transfermarkt_id === tid;
  if (player.outcome === "no_match") return false;
  if (player.rejected_pairs.has(tid)) return false;
  return null;
}

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

  const precision = {};
  const undecidable = {};
  for (const [name, target] of Object.entries(RULES)) {
    const byStratum = {};
    undecidable[name] = 0;
    for (const row of adjudicated) {
      const tid = target(row);
      if (!tid) continue;
      const v = verdict(validation.players.get(text(row.sm_player_data_id)), tid);
      if (v === null) { undecidable[name] += 1; continue; }
      const s = (byStratum[row.stratum] ??= { fired: 0, correct: 0 });
      s.fired += 1;
      if (v) s.correct += 1;
    }
    precision[name] = Object.fromEntries(Object.entries(byStratum).map(([stratum, s]) => [stratum, rate(s.correct, s.fired)]));
  }

  return {
    pending: rows.length - adjudicated.length,
    adjudicated: adjudicated.length,
    decision_conflicts: [...conflicted],
    // Adjudicated rows where a rule fired but the decisions do not say whether
    // its link is right (e.g. unresolved). Reported so they are not silently lost.
    undecidable,
    precision
  };
}
