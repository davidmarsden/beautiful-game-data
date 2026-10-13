import { normaliseName } from "./playerIdentityResolver.js";
import { validateIdentityDecisions } from "./validateIdentityDecisions.js";

// Conservative cross-provider reconciliation between Soccer Manager (SM) and
// Transfermarkt (TM) player identities. Output is a set of *proposals*: nothing
// is written, and no match is treated as confirmed without an unambiguous
// one-to-one assignment or a recorded human decision.

export const ALGORITHM_VERSION = "sm-tm-reconcile/0.7";

// Scoring weights. These are heuristics, not calibrated probabilities.
const POINTS = {
  dobExact: 55,
  nameExact: 30,
  nameTokensMax: 24, // scaled by token similarity when names are not identical
  clubExact: 10,
  nationalityOverlap: 4,
  positionCompatible: 3
};

// A candidate must reach this score to be shown to a reviewer at all.
// Kept low so players without a date of birth still get candidates to review.
const REVIEW_MIN_SCORE = 30;
// Automatic proposals need a strong score, an exact DOB and a clear lead.
const AUTO_MIN_SCORE = 85;
const AUTO_MIN_LEAD = 15;
const MAX_CANDIDATES = 5;

// --- field access -----------------------------------------------------------

function text(value) {
  return String(value ?? "").trim();
}

function isoDate(value) {
  const v = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

function dateOfBirth(row) {
  return isoDate(row.date_of_birth || row.dob || row.birth_date);
}

// Footballers carry several names (formal full name, common display name,
// short name, aliases). Every supplied variant is indexed and compared.
const NAME_FIELDS = ["full_name", "canonical_name", "display_name", "player_name", "name", "short_name", "known_as", "nickname"];
const ALIAS_FIELDS = ["aliases", "name_aliases", "alternative_names", "nicknames"];

function nameVariants(row) {
  const values = [
    ...NAME_FIELDS.map(field => row[field]),
    ...ALIAS_FIELDS.flatMap(field => [row[field]].flat())
  ];
  const variants = new Map(); // normalised key -> original text
  for (const value of values) {
    const original = text(value);
    const key = normaliseName(original);
    if (key && !variants.has(key)) variants.set(key, original);
  }
  return variants;
}

// First non-empty value among alternative ID fields, so an empty earlier
// field never hides a populated later one.
function firstId(...values) {
  for (const value of values) {
    const id = text(value);
    if (id) return id;
  }
  return "";
}

function smId(row) {
  // Stable cross-world identity only. Never the world-specific playerId.
  return firstId(row.player_data_id, row.playerDataId, row.sm_player_data_id);
}

function tmId(row) {
  return firstId(row.transfermarkt_id, row.tm_id, row.player_id);
}

function clubKey(row) {
  return normaliseName(row.real_world_club || row.current_club || row.club_name);
}

function nationalities(row) {
  return new Set(
    [row.nationality, row.nationalities]
      .flat()
      .filter(Boolean)
      .map(normaliseName)
  );
}

// --- name and position comparison --------------------------------------------

function tokenSimilarity(a, b) {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / new Set([...left, ...right]).size;
}

// Maps SM codes (GK, D, DC, DMC, AMC, F...) and TM labels ("Centre-Back",
// "Defensive Midfield"...) to broad position groups by whole words. Unknown
// values map to nothing, so they contribute no evidence rather than false evidence.
const POSITION_GROUP_RULES = [
  ["GK", /\b(gk|g|goalkeeper|keeper)\b/],
  ["DEF", /\b(d|dc|dl|dr|cb|lb|rb|lwb|rwb|wb|sw|defender|back)\b/],
  ["MID", /\b(m|mc|ml|mr|dm|dmc|cm|am|amc|aml|amr|lm|rm|midfielder|midfield)\b/],
  ["FWD", /\b(f|fc|st|cf|lw|rw|forward|striker|winger)\b/]
];

function positionGroups(row) {
  const value = normaliseName(row.position || row.primary_position);
  const groups = new Set();
  if (!value) return groups;
  for (const [group, pattern] of POSITION_GROUP_RULES) {
    if (pattern.test(value)) groups.add(group);
  }
  return groups;
}

// --- scoring ----------------------------------------------------------------

function scorePair(sm, tm) {
  const evidence = [];
  const conflicts = [];
  let score = 0;

  const smDob = dateOfBirth(sm);
  const tmDob = dateOfBirth(tm);
  if (smDob && tmDob) {
    if (smDob === tmDob) {
      evidence.push("dob_exact");
      score += POINTS.dobExact;
    } else {
      conflicts.push("dob_conflict");
    }
  }

  // Compare every SM name variant with every TM variant and keep the best pair,
  // recording which variants produced it.
  let bestName = null;
  for (const [smKey, smText] of nameVariants(sm)) {
    for (const [tmKey, tmText] of nameVariants(tm)) {
      const similarity = smKey === tmKey ? 1 : tokenSimilarity(smKey, tmKey);
      if (!bestName || similarity > bestName.similarity) bestName = { similarity, sm: smText, tm: tmText };
    }
  }
  let matchedName = null;
  if (bestName && bestName.similarity === 1) {
    evidence.push("name_exact");
    score += POINTS.nameExact;
    matchedName = { sm: bestName.sm, tm: bestName.tm };
  } else if (bestName) {
    if (bestName.similarity >= 0.65) evidence.push("name_tokens");
    score += Math.round(bestName.similarity * POINTS.nameTokensMax);
    if (bestName.similarity > 0) matchedName = { sm: bestName.sm, tm: bestName.tm };
  }

  const smClub = clubKey(sm);
  const tmClub = clubKey(tm);
  if (smClub && smClub === tmClub) {
    evidence.push("club_exact");
    score += POINTS.clubExact;
  }

  const smNations = nationalities(sm);
  const tmNations = nationalities(tm);
  if ([...smNations].some(nation => tmNations.has(nation))) {
    evidence.push("nationality_overlap");
    score += POINTS.nationalityOverlap;
  }

  const smGroups = positionGroups(sm);
  const tmGroups = positionGroups(tm);
  if ([...smGroups].some(group => tmGroups.has(group))) {
    evidence.push("position_compatible");
    score += POINTS.positionCompatible;
  }

  return { score, evidence, conflicts, matched_name: matchedName };
}

// --- decisions --------------------------------------------------------------
// Human decisions are checked for consistency by validateIdentityDecisions
// before any matching; see that module for the decision shapes and rules.

// --- main -------------------------------------------------------------------

function addToIndex(index, key, row) {
  if (!key) return;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(row);
}

export function reconcilePlayerIdentities(smRows, tmRows, decisions = [], options = {}) {
  // Block candidates by DOB or normalised name to avoid comparing every pair.
  const tmById = new Map();
  const tmByDob = new Map();
  const tmByName = new Map();
  for (const tm of tmRows) {
    const tid = tmId(tm);
    if (!tid) continue;
    tmById.set(tid, tm);
    addToIndex(tmByDob, dateOfBirth(tm), tm);
    for (const key of nameVariants(tm).keys()) addToIndex(tmByName, key, tm);
  }

  const validation = validateIdentityDecisions(decisions);
  const proposals = [];

  for (const sm of smRows) {
    const sid = smId(sm);
    if (!sid) continue;
    const decision = validation.players.get(sid);

    if (decision?.outcome === "unresolved" || decision?.outcome === "no_match") {
      proposals.push({
        sm_player_data_id: sid,
        status: decision.outcome === "unresolved" ? "unresolved" : "rejected",
        candidates: []
      });
      continue;
    }

    const pool = new Map();
    const blocked = [
      ...(tmByDob.get(dateOfBirth(sm)) || []),
      ...[...nameVariants(sm).keys()].flatMap(key => tmByName.get(key) || [])
    ];
    for (const tm of blocked) pool.set(tmId(tm), tm);

    const candidates = [...pool.values()]
      .filter(tm => !decision?.rejected_pairs.has(tmId(tm)))
      .map(tm => ({ transfermarkt_id: tmId(tm), tbg_player_id: text(tm.tbg_player_id), ...scorePair(sm, tm) }))
      .filter(candidate => candidate.conflicts.length === 0 && candidate.score >= REVIEW_MIN_SCORE)
      .sort((a, b) => b.score - a.score || a.transfermarkt_id.localeCompare(b.transfermarkt_id))
      .slice(0, MAX_CANDIDATES);

    if (decision?.outcome === "conflict") {
      proposals.push({
        sm_player_data_id: sid,
        status: "review",
        conflict: decision.reasons[0],
        conflict_reasons: decision.reasons,
        conflicting_decisions: decision.records,
        candidates
      });
      continue;
    }

    if (decision?.outcome === "match") {
      const confirmed = decision.transfermarkt_id;
      if (tmById.has(confirmed)) {
        proposals.push({ sm_player_data_id: sid, status: "reviewed", reviewed_transfermarkt_id: confirmed, candidates });
      } else {
        proposals.push({ sm_player_data_id: sid, status: "review", conflict: "confirmed_tm_missing", candidates });
      }
      continue;
    }

    const [best, second] = candidates;
    const isAuto = Boolean(
      best &&
      best.score >= AUTO_MIN_SCORE &&
      best.evidence.includes("dob_exact") &&
      (!second || best.score - second.score >= AUTO_MIN_LEAD)
    );
    proposals.push({ sm_player_data_id: sid, status: isAuto ? "proposed_auto" : "review", candidates });
  }

  resolveDuplicateClaims(proposals, validation.confirmations_by_tm);

  const count = status => proposals.filter(p => p.status === status).length;
  return {
    meta: { algorithm_version: ALGORITHM_VERSION, snapshot_id: options.snapshotId ?? null },
    summary: {
      sm_rows: smRows.length,
      tm_rows: tmRows.length,
      proposed_auto: count("proposed_auto"),
      reviewed: count("reviewed"),
      review: count("review"),
      unresolved: count("unresolved"),
      rejected: count("rejected"),
      decision_conflicts: validation.summary.conflicts,
      unattributed_decisions: validation.summary.unattributed
    },
    proposals
  };
}

// One TM identity can belong to only one SM identity.
// Collisions between human confirmations are caught by the validator (every
// confirmation counts, even from players already in conflict). Here, every
// automatic proposal is first recorded, then checked in three ways:
//   1. inconsistent_sm_rows: repeated rows for one SM identity auto-propose
//      different TM players, so none of them is trusted;
//   2. tm_claimed_by_human_decision: a human confirmed that TM player for
//      another SM identity;
//   3. duplicate_tm_claim: distinct SM identities auto-propose the same TM player.
// Collisions count distinct SM identities, so one playerDataId repeated across
// rows (e.g. concatenated snapshots) is not mistaken for two players.
function resolveDuplicateClaims(proposals, confirmationsByTm) {
  const autos = proposals
    .filter(p => p.status === "proposed_auto" && p.candidates[0]?.transfermarkt_id)
    .map(p => ({ proposal: p, sid: p.sm_player_data_id, tid: p.candidates[0].transfermarkt_id }));

  // Record every auto-qualified target before any proposal is demoted.
  const targetsBySm = new Map();
  const claimantsByTm = new Map();
  for (const { sid, tid } of autos) {
    if (!targetsBySm.has(sid)) targetsBySm.set(sid, new Set());
    targetsBySm.get(sid).add(tid);
    if (!claimantsByTm.has(tid)) claimantsByTm.set(tid, new Set());
    claimantsByTm.get(tid).add(sid);
  }

  for (const { proposal, sid, tid } of autos) {
    const humanClaimants = confirmationsByTm.get(tid);
    let conflict = "";
    if (targetsBySm.get(sid).size > 1) conflict = "inconsistent_sm_rows";
    else if (humanClaimants && !humanClaimants.has(sid)) conflict = "tm_claimed_by_human_decision";
    else if (claimantsByTm.get(tid).size > 1) conflict = "duplicate_tm_claim";
    if (conflict) {
      proposal.status = "review";
      proposal.conflict = conflict;
    }
  }
}
