// SM <-> TM identity benchmark. Read-only: it proposes nothing to the playable
// universe and writes nothing to any database. It measures two separate things:
//
//   discovery  - does the right TM player appear anywhere in the candidates?
//                Measured from the TM side (is each TM player found by some SM
//                row?) with the strict reconciler and with a wider diagnostic
//                search (surname token + age within one year).
//   automatic  - would a linking rule pick the right player? This needs truth,
//                so this module only prepares the adjudication samples; the
//                evaluator scores them once a reviewer has filled them in.
//
// Per-player outputs are private (SM data). The summary holds counts only.

import { createHash } from "node:crypto";
import { normaliseName } from "../playerIdentityResolver.js";
import { reconcilePlayerIdentities, ALGORITHM_VERSION } from "../reconcileSmTm.js";
import {
  smToMatcherRow, tmToMatcherRow, ageOn, ageBand, smVariantType, isNonLatin
} from "./adapters.js";

export const BENCHMARK_VERSION = "sm-tm-benchmark/0.1";

const AGE_TOLERANCE = 1; // SM age may be computed on a different date than the snapshot
const WIDE_MIN_TOKEN = 3;
const WIDE_MAX_POSTINGS = 400; // skip tokens too common to be useful
const ASSIST_LIMIT = 5;

const DEFAULT_SAMPLE = {
  // "general" is drawn first so it stays a clean random sample of all TM players.
  tm: { general: 60, brazil_portugal: 40, nickname: 40, non_latin_full_name: 30, youth_u21: 30, veteran_33plus: 30 },
  sm: { unique_age_consistent: 40, unique_age_inconsistent: 30, multiple_candidates: 40, surname_only_match: 30, initial_surname_match: 30, rated_85plus_no_candidate: 30 }
};

function rank(seed, id) {
  return createHash("sha256").update(`${seed}:${id}`).digest("hex");
}

function pct(part, whole) {
  return whole ? Math.round((part / whole) * 1000) / 10 : null;
}

function tokens(value) {
  return normaliseName(value).split(" ").filter(token => token.length >= WIDE_MIN_TOKEN);
}

function ageConsistent(delta) {
  return delta !== null && Math.abs(delta) <= AGE_TOLERANCE;
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

export function runIdentityBenchmark({ smRows, tmRows, snapshotDate, snapshotId = null, seed = "tbg-identity-benchmark", sample = DEFAULT_SAMPLE }) {
  const sm = smRows.map(smToMatcherRow).filter(row => row.player_data_id);
  const tm = tmRows.map(tmToMatcherRow).filter(row => row.transfermarkt_id);
  const smById = new Map(sm.map(row => [row.player_data_id, row]));
  const tmById = new Map(tm.map(row => [row.transfermarkt_id, row]));
  const tmAge = new Map(tm.map(row => [row.transfermarkt_id, ageOn(row.date_of_birth, snapshotDate)]));
  // SM Age is exact on the date the row was observed, so compare TM age on that date.
  const ageDelta = (smRow, tid) => {
    const date = smRow.observed_date || snapshotDate;
    const t = date === snapshotDate ? tmAge.get(tid) : ageOn(tmById.get(tid)?.date_of_birth, date);
    return smRow.age === null || t === null || t === undefined ? null : smRow.age - t;
  };

  // --- strict discovery: the reconciler itself -------------------------------
  const strict = reconcilePlayerIdentities(sm, tm, [], { snapshotId });
  const strictBySm = new Map();
  const strictByTm = new Map();
  for (const proposal of strict.proposals) {
    const smRow = smById.get(proposal.sm_player_data_id);
    const candidates = proposal.candidates.map(c => {
      const delta = ageDelta(smRow, c.transfermarkt_id);
      return {
        transfermarkt_id: c.transfermarkt_id,
        score: c.score,
        evidence: c.evidence,
        sm_variant: smVariantType(smRow, c.matched_name?.sm),
        matched_tm_name: c.matched_name?.tm ?? "",
        age_delta: delta,
        age_consistent: ageConsistent(delta)
      };
    });
    strictBySm.set(proposal.sm_player_data_id, { status: proposal.status, candidates });
    for (const c of candidates) push(strictByTm, c.transfermarkt_id, { sid: proposal.sm_player_data_id, ...c });
  }

  // --- wide discovery: diagnostic only (surname token + age within one year) -
  const tmByToken = new Map();
  for (const row of tm) {
    const own = new Set([row.full_name, row.display_name, row.short_name, row.nickname].flatMap(tokens));
    for (const token of own) push(tmByToken, token, row.transfermarkt_id);
  }
  const wideBySm = new Map();
  const wideByTm = new Map();
  let skippedCommonTokens = 0;
  for (const row of sm) {
    if (row.age === null) continue;
    const surnameTokens = new Set(tokens(row.aliases[0] ?? row.name.split(" ").at(-1)));
    const found = new Set();
    for (const token of surnameTokens) {
      const postings = tmByToken.get(token) ?? [];
      if (postings.length > WIDE_MAX_POSTINGS) { skippedCommonTokens += 1; continue; }
      for (const tid of postings) if (ageConsistent(ageDelta(row, tid))) found.add(tid);
    }
    if (found.size) {
      wideBySm.set(row.player_data_id, [...found]);
      for (const tid of found) push(wideByTm, tid, row.player_data_id);
    }
  }

  // --- SM-side profile ---------------------------------------------------------
  const smClass = new Map();
  const smCounts = { total: sm.length, with_strict_candidate: 0, with_age_consistent_candidate: 0, with_wide_candidate: 0, wide_only: 0 };
  const candidateBuckets = { "0": 0, "1": 0, "2-3": 0, "4+": 0 };
  const bestVariant = {};
  const byRating = {};
  let hypotheticalAge1 = 0;
  const h1Targets = new Map(); // tid -> SM ids for which H-age1 would fire
  for (const row of sm) {
    const entry = strictBySm.get(row.player_data_id) ?? { candidates: [] };
    const n = entry.candidates.length;
    const consistent = entry.candidates.filter(c => c.age_consistent);
    const hasWide = wideBySm.has(row.player_data_id);
    if (n) smCounts.with_strict_candidate += 1;
    if (consistent.length) smCounts.with_age_consistent_candidate += 1;
    if (hasWide) smCounts.with_wide_candidate += 1;
    if (hasWide && !n) smCounts.wide_only += 1;
    candidateBuckets[n === 0 ? "0" : n === 1 ? "1" : n <= 3 ? "2-3" : "4+"] += 1;
    if (n) bestVariant[entry.candidates[0].sm_variant] = (bestVariant[entry.candidates[0].sm_variant] ?? 0) + 1;
    const band = row.rating_band;
    byRating[band] ??= { total: 0, with_strict_candidate: 0, with_wide_candidate: 0 };
    byRating[band].total += 1;
    if (n) byRating[band].with_strict_candidate += 1;
    if (hasWide) byRating[band].with_wide_candidate += 1;

    // Hypothetical rule H-age1 (not implemented in the reconciler): exactly one
    // age-consistent candidate, matched on an exact name, with nationality overlap.
    const h1 = consistent.length === 1 && consistent[0].evidence.includes("name_exact") && consistent[0].evidence.includes("nationality_overlap");
    if (h1) {
      hypotheticalAge1 += 1;
      push(h1Targets, consistent[0].transfermarkt_id, row.player_data_id);
    }

    let cls = "";
    if (!n) cls = band === "85+" ? "rated_85plus_no_candidate" : "no_candidate";
    else if (n === 1 && consistent.length === 1) cls = "unique_age_consistent";
    else if (n === 1) cls = "unique_age_inconsistent";
    else cls = "multiple_candidates";
    smClass.set(row.player_data_id, { cls, h1 });
  }

  // --- TM-side discovery (recall proxy) ---------------------------------------
  const tmStrata = row => {
    const strata = ["general"];
    if (row.nationality.some(n => n === "Brazil" || n === "Portugal")) strata.push("brazil_portugal");
    if (row.nickname) strata.push("nickname");
    if (isNonLatin(row.full_name)) strata.push("non_latin_full_name");
    const age = tmAge.get(row.transfermarkt_id);
    if (age !== null && age <= 20) strata.push("youth_u21");
    if (age !== null && age >= 33) strata.push("veteran_33plus");
    return strata;
  };
  const tmDiscovery = {};
  for (const row of tm) {
    const strictHits = strictByTm.get(row.transfermarkt_id) ?? [];
    const strictFound = strictHits.length > 0;
    const strictAgeFound = strictHits.some(h => h.age_consistent);
    const wideFound = wideByTm.has(row.transfermarkt_id);
    for (const stratum of tmStrata(row)) {
      tmDiscovery[stratum] ??= { total: 0, strict_found: 0, strict_age_consistent_found: 0, wide_found: 0, found_by_either: 0, wide_only: 0 };
      const s = tmDiscovery[stratum];
      s.total += 1;
      if (strictFound) s.strict_found += 1;
      if (strictAgeFound) s.strict_age_consistent_found += 1;
      if (wideFound) s.wide_found += 1;
      if (strictFound || wideFound) s.found_by_either += 1;
      if (wideFound && !strictAgeFound) s.wide_only += 1;
    }
  }
  for (const s of Object.values(tmDiscovery)) {
    s.strict_found_pct = pct(s.strict_found, s.total);
    s.strict_age_consistent_found_pct = pct(s.strict_age_consistent_found, s.total);
    s.wide_found_pct = pct(s.wide_found, s.total);
    s.found_by_either_pct = pct(s.found_by_either, s.total);
  }

  // --- age reliability on unverified one-to-one probes -------------------------
  // Probe: an SM player with exactly one strict candidate, matched on a full
  // forename+surname or surname-only exact name, nationality agreeing, and that
  // TM player claimed by no other SM row. These are NOT verified matches.
  const ageDeltaHistogram = {};
  let probes = 0;
  for (const entry of strictBySm.values()) {
    if (entry.candidates.length !== 1) continue;
    const c = entry.candidates[0];
    if (!c.evidence.includes("name_exact") || !c.evidence.includes("nationality_overlap")) continue;
    if (c.sm_variant !== "forename_surname" && c.sm_variant !== "surname_only") continue;
    if ((strictByTm.get(c.transfermarkt_id) ?? []).length !== 1) continue;
    if (c.age_delta === null) continue;
    probes += 1;
    const key = c.age_delta > 3 ? ">3" : c.age_delta < -3 ? "<-3" : String(c.age_delta);
    ageDeltaHistogram[key] = (ageDeltaHistogram[key] ?? 0) + 1;
  }

  // --- country label agreement --------------------------------------------------
  // Compared after normalisation, as the reconciler compares them.
  const tmNations = new Set(tm.flatMap(row => row.nationality).map(normaliseName));
  const unmatchedCountries = {};
  for (const row of sm) {
    for (const nation of row.nationality) {
      if (!tmNations.has(normaliseName(nation))) unmatchedCountries[nation] = (unmatchedCountries[nation] ?? 0) + 1;
    }
  }

  // H-age1 collisions: TM players it would link to more than one SM player.
  const h1Collisions = [...h1Targets.values()].filter(sids => sids.length > 1);

  // --- gold-standard samples ----------------------------------------------------
  const goldTm = sampleTm({ tm, tmStrata, sample: sample.tm, seed, strictByTm, wideByTm, smById, ageDelta, tmAge, tmDiscovery });
  const goldSm = sampleSm({ sm, smClass, strictBySm, wideBySm, sample: sample.sm, seed, tmById, tmAge });

  // Control group: SM rows with a verified DOB go through the reconciler's
  // exact-DOB path, so its automatic proposals can be inspected directly.
  const dobControl = { sm_rows_with_dob: 0, proposed_auto: 0, review: 0, no_candidate: 0 };
  for (const proposal of strict.proposals) {
    if (!smById.get(proposal.sm_player_data_id)?.date_of_birth) continue;
    dobControl.sm_rows_with_dob += 1;
    if (proposal.status === "proposed_auto") dobControl.proposed_auto += 1;
    else if (!proposal.candidates.length) dobControl.no_candidate += 1;
    else dobControl.review += 1;
  }

  const summary = {
    benchmark_version: BENCHMARK_VERSION,
    algorithm_version: ALGORITHM_VERSION,
    snapshot_id: snapshotId,
    snapshot_date: snapshotDate,
    seed,
    inputs: { sm_rows: sm.length, tm_rows: tm.length },
    structural_findings: {
      sm_rows_with_date_of_birth: dobControl.sm_rows_with_dob,
      reconciler_auto_proposals: strict.summary.proposed_auto,
      dob_control_group: dobControl,
      note: "SM rows carry exact age but almost never a date of birth, so the reconciler's exact-DOB rule cannot fire for most players; automatic linking needs a new, separately calibrated rule."
    },
    sm_side: {
      ...smCounts,
      with_strict_candidate_pct: pct(smCounts.with_strict_candidate, smCounts.total),
      candidate_count_buckets: candidateBuckets,
      best_candidate_name_variant: bestVariant,
      by_rating_band: byRating,
      hypothetical_rule_h_age1_fires: hypotheticalAge1,
      hypothetical_rule_h_age1_distinct_tm_targets: h1Targets.size,
      hypothetical_rule_h_age1_colliding_tm_targets: h1Collisions.length,
      hypothetical_rule_h_age1_sm_rows_in_collisions: h1Collisions.reduce((n, sids) => n + sids.length, 0),
      max_linkable_note: "At most tm_rows SM players can have a TM identity; SM-side rates are not recall."
    },
    tm_side_discovery: tmDiscovery,
    age_reliability_unverified_probes: { probes, age_delta_histogram: ageDeltaHistogram },
    wide_search: { skipped_common_token_lookups: skippedCommonTokens, max_postings: WIDE_MAX_POSTINGS, age_tolerance: AGE_TOLERANCE },
    countries_without_tm_label: Object.fromEntries(Object.entries(unmatchedCountries).sort((a, b) => b[1] - a[1])),
    gold_samples: { tm_anchored: goldTm.length, sm_anchored: goldSm.length }
  };

  const candidates = sm.map(row => ({
    sm_player_data_id: row.player_data_id,
    class: smClass.get(row.player_data_id).cls,
    strict: strictBySm.get(row.player_data_id)?.candidates ?? [],
    wide_transfermarkt_ids: wideBySm.get(row.player_data_id) ?? []
  }));

  return { summary, candidates, goldTm, goldSm };
}

function sampleTm({ tm, tmStrata, sample, seed, strictByTm, wideByTm, smById, ageDelta, tmAge, tmDiscovery }) {
  const taken = new Set();
  const rows = [];
  for (const [stratum, size] of Object.entries(sample)) {
    const pool = tm
      .filter(row => !taken.has(row.transfermarkt_id) && tmStrata(row).includes(stratum))
      .sort((a, b) => rank(seed, `tm:${a.transfermarkt_id}`).localeCompare(rank(seed, `tm:${b.transfermarkt_id}`)))
      .slice(0, size);
    for (const row of pool) {
      taken.add(row.transfermarkt_id);
      const strictIds = [...new Set((strictByTm.get(row.transfermarkt_id) ?? []).map(h => h.sid))];
      const wideIds = wideByTm.get(row.transfermarkt_id) ?? [];
      const assist = [...new Set([...strictIds, ...wideIds])]
        .map(sid => ({ sid, delta: ageDelta(smById.get(sid), row.transfermarkt_id) }))
        .sort((a, b) => Math.abs(a.delta ?? 99) - Math.abs(b.delta ?? 99) || a.sid.localeCompare(b.sid))
        .slice(0, ASSIST_LIMIT)
        .map(({ sid, delta }) => {
          const s = smById.get(sid);
          return `${sid} | ${s.name} | ${s.nationality.join("/")} | age ${s.age} (Δ${delta})`;
        });
      rows.push({
        stratum,
        stratum_size: tmDiscovery[stratum]?.total ?? null,
        transfermarkt_id: row.transfermarkt_id,
        tm_full_name: row.full_name,
        tm_display_name: row.display_name,
        tm_nickname: row.nickname,
        tm_date_of_birth: row.date_of_birth,
        tm_age_at_snapshot: tmAge.get(row.transfermarkt_id),
        tm_nationality: row.nationality.join("/"),
        tm_position: row.position,
        strict_sm_ids: strictIds.join(" "),
        wide_sm_ids: wideIds.join(" "),
        assist_candidates: assist.join(" || "),
        truth_sm_player_data_id: "",
        truth_status: "", // found | not_in_sm | unsure
        reviewer: "",
        decided_at: "",
        notes: ""
      });
    }
  }
  return rows;
}

function sampleSm({ sm, smClass, strictBySm, wideBySm, sample, seed, tmById, tmAge }) {
  const taken = new Set();
  const rows = [];
  const strataOf = row => {
    const { cls } = smClass.get(row.player_data_id);
    const strata = [cls];
    const top = strictBySm.get(row.player_data_id)?.candidates[0];
    if (top?.sm_variant === "surname_only") strata.push("surname_only_match");
    if (top?.sm_variant === "initial_surname") strata.push("initial_surname_match");
    return strata;
  };
  const stratumSizes = {};
  for (const row of sm) for (const s of strataOf(row)) stratumSizes[s] = (stratumSizes[s] ?? 0) + 1;

  for (const [stratum, size] of Object.entries(sample)) {
    const pool = sm
      .filter(row => !taken.has(row.player_data_id) && strataOf(row).includes(stratum))
      .sort((a, b) => rank(seed, `sm:${a.player_data_id}`).localeCompare(rank(seed, `sm:${b.player_data_id}`)))
      .slice(0, size);
    for (const row of pool) {
      taken.add(row.player_data_id);
      const entry = strictBySm.get(row.player_data_id) ?? { candidates: [] };
      const describe = c => {
        const t = tmById.get(c.transfermarkt_id);
        return `${c.transfermarkt_id} | ${t.display_name} | ${t.date_of_birth} (age ${tmAge.get(c.transfermarkt_id)}, Δ${c.age_delta}) | ${t.nationality.join("/")} | score ${c.score} | ${c.sm_variant}`;
      };
      const top = entry.candidates[0];
      rows.push({
        stratum,
        stratum_size: stratumSizes[stratum] ?? 0,
        sm_player_data_id: row.player_data_id,
        sm_name: row.name,
        sm_short_name: row.short_name,
        sm_age: row.age,
        sm_nationality: row.nationality.join("/"),
        sm_position: row.position,
        sm_rating_band: row.rating_band,
        sm_age_band: ageBand(row.age),
        h_age1_fires: smClass.get(row.player_data_id).h1,
        proposed_transfermarkt_id: top?.transfermarkt_id ?? "",
        strict_candidates: entry.candidates.map(describe).join(" || "),
        wide_transfermarkt_ids: (wideBySm.get(row.player_data_id) ?? []).join(" "),
        // Decision columns, in validateIdentityDecisions shape:
        transfermarkt_id: "",
        status: "", // confirmed | rejected | unresolved
        reviewer: "",
        decided_at: "",
        notes: ""
      });
    }
  }
  return rows;
}
