import test from "node:test";
import assert from "node:assert/strict";
import { smToMatcherRow, tmToMatcherRow, smPositionTitle, ageOn, smVariantType } from "../src/identity/benchmark/adapters.js";
import { runIdentityBenchmark } from "../src/identity/benchmark/runIdentityBenchmark.js";
import { evaluateTmGold, evaluateSmGold } from "../src/identity/benchmark/evaluateGold.js";
import { toCsv, parseCsv } from "../src/identity/benchmark/csv.js";

const smRow = (id, forename, surname, age, country, position = '<acronym title="Forward Centre">F(C)</acronym>', rating_band = "80-84") => ({
  player_data_id: id, forename, surname, player_name: `${forename[0]}.${surname}`, age: String(age), country, position_dis: position, rating_band
});
const tmRow = (id, display, dob, nationality, extra = {}) => ({
  transfermarkt_id: String(id), full_name: display, display_name: display, short_name: "", nickname: "",
  date_of_birth: dob, nationality: [nationality], position: "Centre-Forward", current_club: "Real Club", ...extra
});

test("SM adapter keeps names, maps countries and never passes a club", () => {
  const row = smToMatcherRow({ ...smRow(1, "Ferreira", "VITINHA", 26, "Turkey"), club_name: "Game World FC" });
  assert.equal(row.name, "Ferreira VITINHA");
  assert.deepEqual(row.aliases, ["VITINHA"]);
  assert.equal(row.short_name, "F VITINHA");
  assert.deepEqual(row.nationality, ["Türkiye"]);
  assert.equal(row.position, "Forward Centre");
  assert.equal(row.current_club, undefined);
  assert.equal(row.club_name, undefined);
});

test("TM adapter drops club fields", () => {
  const row = tmToMatcherRow(tmRow(10, "Vitinha", "2000-02-13", "Portugal"));
  assert.equal(row.current_club, undefined);
  assert.equal(row.transfermarkt_id, "10");
});

test("position titles are read from SM HTML", () => {
  assert.equal(smPositionTitle('<acronym title="Defender Centre">D(C)</acronym>'), "Defender Centre");
  assert.equal(smPositionTitle("GK"), "GK");
});

test("age on a reference date respects birthdays", () => {
  assert.equal(ageOn("2000-10-12", "2026-10-12"), 26);
  assert.equal(ageOn("2000-10-13", "2026-10-12"), 25);
  assert.equal(ageOn("", "2026-10-12"), null);
});

test("Brazilian/Portuguese football names are discovered through the surname alias", () => {
  const sm = [smRow(1, "Ferreira", "VITINHA", 26, "Portugal"), smRow(2, "Hernández", "RODRI", 30, "Spain")];
  const tm = [tmRow(10, "Vitinha", "2000-02-13", "Portugal"), tmRow(11, "Rodri", "1996-06-22", "Spain")];
  const { candidates, summary } = runIdentityBenchmark({ smRows: sm, tmRows: tm, snapshotDate: "2026-10-12", sample: { tm: {}, sm: {} } });
  const bySm = Object.fromEntries(candidates.map(c => [c.sm_player_data_id, c]));
  assert.equal(bySm["1"].strict[0].transfermarkt_id, "10");
  assert.equal(bySm["1"].strict[0].sm_variant, "surname_only");
  assert.equal(bySm["1"].strict[0].age_delta, 0);
  assert.equal(bySm["2"].strict[0].transfermarkt_id, "11");
  assert.equal(summary.tm_side_discovery.general.strict_found, 2);
});

test("the current reconciler makes no automatic proposals without SM birth dates", () => {
  const { summary } = runIdentityBenchmark({
    smRows: [smRow(1, "Erling", "HAALAND", 26, "Norway")],
    tmRows: [tmRow(10, "Erling Haaland", "2000-07-21", "Norway")],
    snapshotDate: "2026-10-12",
    sample: { tm: {}, sm: {} }
  });
  assert.equal(summary.structural_findings.reconciler_auto_proposals, 0);
  assert.equal(summary.sm_side.hypothetical_rule_h_age1_fires, 1);
});

test("wide search finds transliterated names the strict reconciler misses, within one year of age", () => {
  const sm = [smRow(1, "Yegor", "YARMOLYUK", 22, "Ukraine"), smRow(2, "Other", "YARMOLYUK", 35, "Ukraine")];
  const tm = [tmRow(10, "Yehor Yarmolyuk", "2004-03-01", "Ukraine")];
  const { candidates, summary } = runIdentityBenchmark({ smRows: sm, tmRows: tm, snapshotDate: "2026-10-12", sample: { tm: {}, sm: {} } });
  const bySm = Object.fromEntries(candidates.map(c => [c.sm_player_data_id, c]));
  assert.equal(bySm["1"].strict.length, 0);
  assert.deepEqual(bySm["1"].wide_transfermarkt_ids, ["10"]);
  assert.deepEqual(bySm["2"].wide_transfermarkt_ids, []);
  assert.equal(summary.tm_side_discovery.general.wide_only, 1);
});

test("variant type identifies which SM name matched", () => {
  const row = smToMatcherRow(smRow(1, "Harry", "KANE", 33, "England"));
  assert.equal(smVariantType(row, "Harry KANE"), "forename_surname");
  assert.equal(smVariantType(row, "KANE"), "surname_only");
  assert.equal(smVariantType(row, "H KANE"), "initial_surname");
});

test("gold samples are deterministic and carry adjudication columns", () => {
  const sm = Array.from({ length: 30 }, (_, i) => smRow(i + 1, "Player", `NAME${i}`, 25, "England"));
  const tm = Array.from({ length: 30 }, (_, i) => tmRow(100 + i, `Player Name${i}`, "2001-01-01", "England"));
  const opts = { smRows: sm, tmRows: tm, snapshotDate: "2026-10-12", sample: { tm: { general: 5 }, sm: { unique_age_consistent: 5 } } };
  const a = runIdentityBenchmark(opts);
  const b = runIdentityBenchmark(opts);
  assert.deepEqual(a.goldTm.map(r => r.transfermarkt_id), b.goldTm.map(r => r.transfermarkt_id));
  assert.equal(a.goldTm.length, 5);
  assert.equal(a.goldSm.length, 5);
  assert.ok("truth_sm_player_data_id" in a.goldTm[0]);
  assert.ok("status" in a.goldSm[0] && "transfermarkt_id" in a.goldSm[0]);
  const other = runIdentityBenchmark({ ...opts, seed: "different" });
  assert.notDeepEqual(a.goldTm.map(r => r.transfermarkt_id), other.goldTm.map(r => r.transfermarkt_id));
});

test("CSV round-trips quotes, commas and newlines", () => {
  const rows = [{ a: 'He said "hi", ok', b: "line1\nline2", c: "" }];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test("TM gold evaluation separates strict and wide discovery recall", () => {
  const rows = [
    { stratum: "general", truth_status: "found", truth_sm_player_data_id: "1", strict_sm_ids: "1", wide_sm_ids: "1" },
    { stratum: "general", truth_status: "found", truth_sm_player_data_id: "2", strict_sm_ids: "", wide_sm_ids: "2 3" },
    { stratum: "general", truth_status: "found", truth_sm_player_data_id: "4", strict_sm_ids: "", wide_sm_ids: "" },
    { stratum: "general", truth_status: "not_in_sm" },
    { stratum: "general", truth_status: "" }
  ];
  const r = evaluateTmGold(rows);
  assert.equal(r.pending, 1);
  assert.deepEqual(r.discovery.general.strict_recall, { hit: 1, total: 3, pct: 33.3 });
  assert.deepEqual(r.discovery.general.either_recall, { hit: 2, total: 3, pct: 66.7 });
  assert.equal(r.discovery.general.not_in_sm, 1);
});

test("SM gold evaluation scores rule precision and excludes contradictory adjudications", () => {
  const rows = [
    { stratum: "unique_age_consistent", sm_player_data_id: "1", proposed_transfermarkt_id: "10", h_age1_fires: "true", h_age1_target_transfermarkt_id: "10", transfermarkt_id: "10", status: "confirmed" },
    { stratum: "unique_age_consistent", sm_player_data_id: "2", proposed_transfermarkt_id: "11", h_age1_fires: "true", h_age1_target_transfermarkt_id: "11", transfermarkt_id: "", status: "rejected" },
    { stratum: "multiple_candidates", sm_player_data_id: "3", proposed_transfermarkt_id: "12", h_age1_fires: "false", transfermarkt_id: "13", status: "confirmed" },
    { stratum: "multiple_candidates", sm_player_data_id: "4", proposed_transfermarkt_id: "13", h_age1_fires: "false", transfermarkt_id: "13", status: "confirmed" },
    { stratum: "multiple_candidates", sm_player_data_id: "5", proposed_transfermarkt_id: "14", h_age1_fires: "false", transfermarkt_id: "", status: "" }
  ];
  const r = evaluateSmGold(rows);
  assert.equal(r.pending, 1);
  assert.deepEqual(r.precision.h_age1.unique_age_consistent, { hit: 1, total: 2, pct: 50 });
  // SM 3 and 4 both confirmed to TM 13: a decision conflict, so neither is scored.
  assert.deepEqual(r.decision_conflicts.sort(), ["3", "4"]);
  assert.equal(r.precision.top_candidate.multiple_candidates, undefined);
});

test("SM rows with a verified DOB use the exact-DOB path as a control group", () => {
  const sm = [{ ...smRow(1, "Erling", "HAALAND", 26, "Norway"), date_of_birth: "2000-07-21", observed_at: "2026-10-12T20:10:39Z" }];
  const { summary } = runIdentityBenchmark({ smRows: sm, tmRows: [tmRow(10, "Erling Haaland", "2000-07-21", "Norway")], snapshotDate: "2026-10-12", sample: { tm: {}, sm: {} } });
  assert.equal(summary.structural_findings.dob_control_group.sm_rows_with_dob, 1);
  assert.equal(summary.structural_findings.dob_control_group.proposed_auto, 1);
});

test("age is compared on each SM row's own observation date", () => {
  const sm = [{ ...smRow(1, "Erling", "HAALAND", 25, "Norway"), observed_at: "2026-01-01T00:00:00Z" }];
  const { candidates } = runIdentityBenchmark({ smRows: sm, tmRows: [tmRow(10, "Erling Haaland", "2000-07-21", "Norway")], snapshotDate: "2026-10-12", sample: { tm: {}, sm: {} } });
  assert.equal(candidates[0].strict[0].age_delta, 0);
});

test("H-age1 collisions and accent-insensitive country checks are reported", () => {
  const sm = [smRow(1, "Alex", "SMITH", 25, "Curaçao"), smRow(2, "Alex", "SMITH", 25, "Curaçao")];
  const tm = [tmRow(10, "Alex Smith", "2001-01-01", "Curacao")];
  const { summary } = runIdentityBenchmark({ smRows: sm, tmRows: tm, snapshotDate: "2026-10-12", sample: { tm: {}, sm: {} } });
  assert.equal(summary.sm_side.hypothetical_rule_h_age1_fires, 2);
  assert.equal(summary.sm_side.hypothetical_rule_h_age1_distinct_tm_targets, 1);
  assert.equal(summary.sm_side.hypothetical_rule_h_age1_colliding_tm_targets, 1);
  assert.deepEqual(summary.countries_without_tm_label, {});
});

// --- Codex review regressions (PR #48) ---

test("H-age1 is scored against its own age-consistent target, not the top candidate", () => {
  const sm = [smRow(1, "Alex", "SMITH", 25, "England", '<acronym title="Goalkeeper">GK</acronym>')];
  const tm = [
    { ...tmRow(10, "Alex Smith", "1990-01-01", "England"), position: "Goalkeeper" }, // ranks first, wrong age
    tmRow(11, "Alex Smith", "2001-01-01", "England") // the only age-consistent candidate
  ];
  const { goldSm } = runIdentityBenchmark({ smRows: sm, tmRows: tm, snapshotDate: "2026-10-12", sample: { tm: {}, sm: { multiple_candidates: 5 } } });
  assert.equal(goldSm[0].proposed_transfermarkt_id, "10");
  assert.equal(goldSm[0].h_age1_fires, true);
  assert.equal(goldSm[0].h_age1_target_transfermarkt_id, "11");

  const r = evaluateSmGold([{ ...goldSm[0], h_age1_fires: "true", transfermarkt_id: "11", status: "confirmed" }]);
  assert.deepEqual(r.precision.h_age1.multiple_candidates, { hit: 1, total: 1, pct: 100 });
  assert.deepEqual(r.precision.top_candidate.multiple_candidates, { hit: 0, total: 1, pct: 0 });
});

test("a pair rejection of the proposed link counts as a false positive", () => {
  const r = evaluateSmGold([
    { stratum: "s", sm_player_data_id: "1", proposed_transfermarkt_id: "10", h_age1_fires: "true", h_age1_target_transfermarkt_id: "10", transfermarkt_id: "10", status: "rejected" }
  ]);
  assert.deepEqual(r.precision.h_age1.s, { hit: 0, total: 1, pct: 0 });
  assert.deepEqual(r.precision.top_candidate.s, { hit: 0, total: 1, pct: 0 });
});

test("adjudications that cannot decide a rule's link are counted, not dropped", () => {
  const r = evaluateSmGold([
    { stratum: "s", sm_player_data_id: "1", proposed_transfermarkt_id: "10", h_age1_fires: "true", h_age1_target_transfermarkt_id: "10", transfermarkt_id: "", status: "unresolved" },
    { stratum: "s", sm_player_data_id: "2", proposed_transfermarkt_id: "11", h_age1_fires: "false", h_age1_target_transfermarkt_id: "", transfermarkt_id: "12", status: "rejected" }
  ]);
  assert.equal(r.undecidable.h_age1, 1);
  assert.equal(r.undecidable.top_candidate, 2);
});

test("wide-only counts only TM players the strict search did not find at all", () => {
  // Strict finds TM 10 (exact name) but at the wrong age; wide finds it at the right age via another SM row.
  const sm = [smRow(1, "Alex", "SMITH", 40, "England"), smRow(2, "Alexander", "SMITH", 25, "England")];
  const tm = [tmRow(10, "Alex Smith", "2001-01-01", "England")];
  const { summary } = runIdentityBenchmark({ smRows: sm, tmRows: tm, snapshotDate: "2026-10-12", sample: { tm: {}, sm: {} } });
  const g = summary.tm_side_discovery.general;
  assert.equal(g.strict_found, 1);
  assert.equal(g.strict_age_consistent_found, 0);
  assert.equal(g.wide_found, 1);
  assert.equal(g.wide_only, 0);
});

test("malformed TM adjudications are reported as invalid and excluded from recall", () => {
  const r = evaluateTmGold([
    { stratum: "general", transfermarkt_id: "10", truth_status: "found", truth_sm_player_data_id: "1", strict_sm_ids: "1", wide_sm_ids: "" },
    { stratum: "general", transfermarkt_id: "11", truth_status: "fonud", truth_sm_player_data_id: "2", strict_sm_ids: "", wide_sm_ids: "" },
    { stratum: "general", transfermarkt_id: "12", truth_status: "found", truth_sm_player_data_id: "", strict_sm_ids: "", wide_sm_ids: "" },
    { stratum: "general", transfermarkt_id: "13", truth_status: "not_in_sm", truth_sm_player_data_id: "3", strict_sm_ids: "", wide_sm_ids: "" },
    { stratum: "general", transfermarkt_id: "14", truth_status: "unsure", truth_sm_player_data_id: "4", strict_sm_ids: "", wide_sm_ids: "" }
  ]);
  assert.deepEqual(r.invalid, [
    { transfermarkt_id: "11", reason: "unknown_status:fonud" },
    { transfermarkt_id: "12", reason: "found_without_sm_id" },
    { transfermarkt_id: "13", reason: "not_in_sm_with_sm_id" },
    { transfermarkt_id: "14", reason: "unsure_with_sm_id" }
  ]);
  assert.equal(r.unsure, 0);
  assert.equal(r.discovery.general.adjudicated, 1);
  assert.deepEqual(r.discovery.general.strict_recall, { hit: 1, total: 1, pct: 100 });
});

test("row fingerprints ignore order and key order but detect content changes", async () => {
  const { rowsFingerprint } = await import("../src/identity/benchmark/fingerprint.js");
  const a = [{ player_data_id: "2", age: "25", name: "B" }, { player_data_id: "10", name: "A", age: "30" }];
  const b = [{ age: "30", name: "A", player_data_id: "10" }, { name: "B", player_data_id: "2", age: "25" }];
  assert.equal(rowsFingerprint(a), rowsFingerprint(b));
  const c = [{ ...b[0], age: "31" }, b[1]];
  assert.notEqual(rowsFingerprint(a), rowsFingerprint(c));
});

test("row fingerprints ignore the order of duplicate and equal-looking IDs", async () => {
  const { rowsFingerprint } = await import("../src/identity/benchmark/fingerprint.js");
  const x = { player_data_id: "1", name: "A" };
  const y = { player_data_id: "1", name: "B" };
  const z = { player_data_id: "01", name: "C" };
  assert.equal(rowsFingerprint([x, y, z]), rowsFingerprint([z, y, x]));
  assert.equal(rowsFingerprint([x, y, z]), rowsFingerprint([y, z, x]));
});
