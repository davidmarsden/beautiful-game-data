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
  const row = smToMatcherRow({ ...smRow(1, "Ferreira", "VITINHA", 26, "Turkey"), club_name: "Hellas Verona" });
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
    { stratum: "unique_age_consistent", sm_player_data_id: "1", proposed_transfermarkt_id: "10", h_age1_fires: "true", transfermarkt_id: "10", status: "confirmed" },
    { stratum: "unique_age_consistent", sm_player_data_id: "2", proposed_transfermarkt_id: "11", h_age1_fires: "true", transfermarkt_id: "", status: "rejected" },
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
