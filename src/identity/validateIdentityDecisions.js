// Human-adjudication consistency validator for SM <-> TM identity decisions.
//
// Runs before matching. Every decision about one SM player is reduced to a
// verdict; if the verdicts cannot all be true, the player is marked as a
// conflict and every record is preserved as evidence. Nothing is resolved by
// input order, timestamps or reviewer. There is no supersession rule yet: one
// would have to be explicit (e.g. a `supersedes` field) and implemented here.
//
// Decision shapes:
//   { sm_player_data_id, transfermarkt_id, status: "confirmed" }  this pair is the same player
//   { sm_player_data_id, transfermarkt_id, status: "rejected" }   this pair is NOT the same player
//   { sm_player_data_id, status: "rejected" }                     this SM player has no TM identity
//   { sm_player_data_id, status: "unresolved" }                   parked; do not propose
//
// Outcome verdicts (mutually exclusive): match(tm), no_match, unresolved.
// Pair rejections narrow candidates and are compatible with any outcome except
// a match to the same TM player. Across players, a TM identity confirmed for
// more than one SM player is a conflict for every one of them.

function text(value) {
  return String(value ?? "").trim();
}

function classify(decision) {
  const tid = text(decision.transfermarkt_id);
  if (decision.status === "confirmed") return tid ? { kind: "match", tid } : { kind: "invalid" };
  if (decision.status === "rejected") return tid ? { kind: "not_pair", tid } : { kind: "no_match" };
  if (decision.status === "unresolved") return { kind: "unresolved" };
  return { kind: "invalid" };
}

function conflictReasons(entry) {
  const reasons = [];
  const matches = [...entry.matches];
  if (entry.invalid) reasons.push("invalid_decision");
  if (matches.length > 1) reasons.push("conflicting_confirmations");
  if (matches.length && matches.some(tid => entry.rejectedPairs.has(tid))) reasons.push("confirmed_and_rejected");
  if (matches.length && entry.noMatch) reasons.push("confirmed_and_no_match");
  if (matches.length && entry.unresolved) reasons.push("confirmed_and_unresolved");
  if (entry.noMatch && entry.unresolved) reasons.push("no_match_and_unresolved");
  return reasons;
}

export function validateIdentityDecisions(decisions = []) {
  const bySm = new Map();
  const unattributed = [];

  for (const decision of decisions) {
    const sid = text(decision?.sm_player_data_id);
    if (!sid) {
      unattributed.push(decision);
      continue;
    }
    if (!bySm.has(sid)) {
      bySm.set(sid, { matches: new Set(), rejectedPairs: new Set(), noMatch: false, unresolved: false, invalid: false, records: [] });
    }
    const entry = bySm.get(sid);
    entry.records.push(decision);
    const verdict = classify(decision);
    if (verdict.kind === "match") entry.matches.add(verdict.tid);
    else if (verdict.kind === "not_pair") entry.rejectedPairs.add(verdict.tid);
    else if (verdict.kind === "no_match") entry.noMatch = true;
    else if (verdict.kind === "unresolved") entry.unresolved = true;
    else entry.invalid = true;
  }

  // Cross-player check: one TM identity may be confirmed for only one SM player.
  // Every confirmation counts, including those of players already in conflict,
  // so a conflicted player's evidence still blocks another player's claim.
  const confirmationsByTm = new Map();
  for (const [sid, entry] of bySm) {
    for (const tid of entry.matches) {
      if (!confirmationsByTm.has(tid)) confirmationsByTm.set(tid, new Set());
      confirmationsByTm.get(tid).add(sid);
    }
  }

  const players = new Map();
  for (const [sid, entry] of bySm) {
    const reasons = conflictReasons(entry);
    const shared = [...entry.matches].filter(tid => confirmationsByTm.get(tid).size > 1);
    if (shared.length) reasons.push("tm_confirmed_for_multiple_sm");
    let outcome = "open"; // only pair rejections, or nothing decisive
    if (reasons.length) outcome = "conflict";
    else if (entry.matches.size) outcome = "match";
    else if (entry.noMatch) outcome = "no_match";
    else if (entry.unresolved) outcome = "unresolved";

    players.set(sid, {
      outcome,
      transfermarkt_id: outcome === "match" ? [...entry.matches][0] : "",
      rejected_pairs: entry.rejectedPairs,
      reasons,
      records: entry.records,
      shared_transfermarkt_ids: shared.sort()
    });
  }

  return {
    players,
    confirmations_by_tm: confirmationsByTm,
    unattributed,
    summary: {
      decisions: decisions.length,
      sm_players: players.size,
      conflicts: [...players.values()].filter(p => p.outcome === "conflict").length,
      unattributed: unattributed.length
    }
  };
}
