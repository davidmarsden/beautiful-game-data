import test from "node:test";
import assert from "node:assert/strict";
import { reconcilePlayerIdentities, ALGORITHM_VERSION } from "../src/identity/reconcileSmTm.js";

const sm = (id, name, dob, extra = {}) => ({ playerDataId: id, name, date_of_birth: dob, current_club: "Club A", ...extra });
const tm = (id, name, dob, extra = {}) => ({ transfermarkt_id: id, name, date_of_birth: dob, current_club: "Club A", ...extra });
const statuses = result => result.proposals.map(p => p.status);
const candidateIds = proposal => proposal.candidates.map(c => c.transfermarkt_id);

test("strong DOB, name and club produces an unambiguous proposal", () => {
  const r = reconcilePlayerIdentities([sm(1, "José García", "2000-01-02")], [tm(10, "Jose Garcia", "2000-01-02")]);
  assert.equal(r.proposals[0].status, "proposed_auto");
  assert.equal(r.proposals[0].candidates[0].transfermarkt_id, "10");
});

test("contradictory birth dates cannot link", () => {
  const r = reconcilePlayerIdentities([sm(1, "Alex Smith", "2000-01-02")], [tm(10, "Alex Smith", "2001-01-02")]);
  assert.equal(r.proposals[0].status, "review");
  assert.equal(r.proposals[0].candidates.length, 0);
});

test("same name and birth date across multiple identities requires review", () => {
  const r = reconcilePlayerIdentities([sm(1, "Alex Smith", "2000-01-02")], [tm(10, "Alex Smith", "2000-01-02"), tm(11, "Alex Smith", "2000-01-02")]);
  assert.equal(r.proposals[0].status, "review");
});

test("two SM identities cannot automatically claim the same TM identity", () => {
  const r = reconcilePlayerIdentities([sm(1, "Alex Smith", "2000-01-02"), sm(2, "Alex Smith", "2000-01-02")], [tm(10, "Alex Smith", "2000-01-02")]);
  assert.deepEqual(statuses(r), ["review", "review"]);
  assert.ok(r.proposals.every(p => p.conflict === "duplicate_tm_claim"));
});

test("player-level rejection means no TM identity", () => {
  const r = reconcilePlayerIdentities([sm(1, "Alex Smith", "2000-01-02")], [tm(10, "Alex Smith", "2000-01-02")], [{ sm_player_data_id: "1", status: "rejected" }]);
  assert.equal(r.proposals[0].status, "rejected");
  assert.equal(r.summary.rejected, 1);
});

test("a human confirmation outranks an automatic proposal for the same TM identity", () => {
  const r = reconcilePlayerIdentities(
    [sm(1, "Alex Smith", "2000-01-02"), sm(2, "Alex Smith", "2000-01-02")],
    [tm(10, "Alex Smith", "2000-01-02")],
    [{ sm_player_data_id: "1", transfermarkt_id: "10", status: "confirmed" }]
  );
  assert.equal(r.proposals[0].status, "reviewed");
  assert.equal(r.proposals[0].reviewed_transfermarkt_id, "10");
  assert.equal(r.proposals[1].status, "review");
  assert.equal(r.proposals[1].conflict, "tm_claimed_by_human_decision");
});

test("two human confirmations of one TM identity are surfaced, not dropped", () => {
  const r = reconcilePlayerIdentities(
    [sm(1, "Alex Smith", "2000-01-02"), sm(2, "Alex Smith", "2000-01-02")],
    [tm(10, "Alex Smith", "2000-01-02")],
    [
      { sm_player_data_id: "1", transfermarkt_id: "10", status: "confirmed" },
      { sm_player_data_id: "2", transfermarkt_id: "10", status: "confirmed" }
    ]
  );
  assert.deepEqual(statuses(r), ["review", "review"]);
  assert.ok(r.proposals.every(p => p.conflict === "tm_confirmed_for_multiple_sm" && p.conflicting_decisions.length === 1));
});

test("pairwise rejection removes only that candidate", () => {
  const r = reconcilePlayerIdentities(
    [sm(1, "Alex Smith", "2000-01-02")],
    [tm(10, "Alex Smith", "2000-01-02"), tm(11, "Alex Smith", "2000-01-02", { current_club: "Club B" })],
    [{ sm_player_data_id: "1", transfermarkt_id: "10", status: "rejected" }]
  );
  assert.deepEqual(candidateIds(r.proposals[0]), ["11"]);
  assert.equal(r.proposals[0].status, "proposed_auto");
});

test("a missing DOB still gives reviewers candidates but never auto-proposes", () => {
  const r = reconcilePlayerIdentities([sm(1, "Erling Haaland", null)], [tm(10, "Erling Haaland", "2000-07-21")]);
  assert.equal(r.proposals[0].status, "review");
  assert.deepEqual(candidateIds(r.proposals[0]), ["10"]);
});

test("a confirmation pointing at an unknown TM identity is not accepted", () => {
  const r = reconcilePlayerIdentities([sm(1, "Alex Smith", "2000-01-02")], [], [{ sm_player_data_id: "1", transfermarkt_id: "999", status: "confirmed" }]);
  assert.equal(r.proposals[0].status, "review");
  assert.equal(r.proposals[0].conflict, "confirmed_tm_missing");
});

test("unresolved decisions park the player", () => {
  const r = reconcilePlayerIdentities([sm(1, "Alex Smith", "2000-01-02")], [tm(10, "Alex Smith", "2000-01-02")], [{ sm_player_data_id: "1", status: "unresolved" }]);
  assert.equal(r.proposals[0].status, "unresolved");
});

test("auto threshold boundary: DOB and exact name alone reach 85; weaker evidence does not", () => {
  const exact = reconcilePlayerIdentities([sm(1, "Danny Ward", "1993-06-22", { current_club: "" })], [tm(10, "Danny Ward", "1993-06-22", { current_club: "" })]);
  assert.equal(exact.proposals[0].candidates[0].score, 85);
  assert.equal(exact.proposals[0].status, "proposed_auto");

  const partial = reconcilePlayerIdentities([sm(1, "Fabio Da Silva", "1990-07-09", { current_club: "" })], [tm(10, "Rafael Da Silva", "1990-07-09", { current_club: "" })]);
  assert.equal(partial.proposals[0].status, "review");
});

test("single-letter SM position codes match whole position groups only", () => {
  const defender = reconcilePlayerIdentities([sm(1, "Alex Smith", "2000-01-02", { position: "D" })], [tm(10, "Alex Smith", "2000-01-02", { position: "Centre-Back" })]);
  assert.ok(defender.proposals[0].candidates[0].evidence.includes("position_compatible"));

  const midfielder = reconcilePlayerIdentities([sm(1, "Alex Smith", "2000-01-02", { position: "D" })], [tm(10, "Alex Smith", "2000-01-02", { position: "Defensive Midfield" })]);
  assert.ok(!midfielder.proposals[0].candidates[0].evidence.includes("position_compatible"));
});

test("output records the algorithm version and snapshot", () => {
  const r = reconcilePlayerIdentities([], [], [], { snapshotId: "sm-2026-10-12" });
  assert.deepEqual(r.meta, { algorithm_version: ALGORITHM_VERSION, snapshot_id: "sm-2026-10-12" });
});

// --- Codex review regressions (PR #47) ---

test("conflicting confirmations for one SM player force review regardless of order", () => {
  const sms = [sm(1, "Alex Smith", "2000-01-02")];
  const tms = [tm(10, "Alex Smith", "2000-01-02"), tm(11, "Alex Smith", "2000-01-02")];
  const a = { sm_player_data_id: "1", transfermarkt_id: "10", status: "confirmed", reviewer: "A" };
  const b = { sm_player_data_id: "1", transfermarkt_id: "11", status: "confirmed", reviewer: "B" };
  for (const decisions of [[a, b], [b, a]]) {
    const p = reconcilePlayerIdentities(sms, tms, decisions).proposals[0];
    assert.equal(p.status, "review");
    assert.equal(p.conflict, "conflicting_confirmations");
    assert.equal(p.reviewed_transfermarkt_id, undefined);
    assert.equal(p.conflicting_decisions.length, 2);
    assert.deepEqual(p.conflicting_decisions.map(d => d.reviewer).sort(), ["A", "B"]);
  }
});

test("repeating the same confirmation is not a conflict", () => {
  const d = { sm_player_data_id: "1", transfermarkt_id: "10", status: "confirmed" };
  const p = reconcilePlayerIdentities([sm(1, "Alex Smith", "2000-01-02")], [tm(10, "Alex Smith", "2000-01-02")], [d, { ...d }]).proposals[0];
  assert.equal(p.status, "reviewed");
});

test("a confirmation contradicted by a rejection of the same pair forces review", () => {
  const p = reconcilePlayerIdentities(
    [sm(1, "Alex Smith", "2000-01-02")],
    [tm(10, "Alex Smith", "2000-01-02")],
    [
      { sm_player_data_id: "1", transfermarkt_id: "10", status: "confirmed" },
      { sm_player_data_id: "1", transfermarkt_id: "10", status: "rejected" }
    ]
  ).proposals[0];
  assert.equal(p.status, "review");
  assert.equal(p.conflict, "confirmed_and_rejected");
});

test("a confirmation contradicted by a no-match rejection forces review", () => {
  const p = reconcilePlayerIdentities(
    [sm(1, "Alex Smith", "2000-01-02")],
    [tm(10, "Alex Smith", "2000-01-02")],
    [
      { sm_player_data_id: "1", transfermarkt_id: "10", status: "confirmed" },
      { sm_player_data_id: "1", status: "rejected" }
    ]
  ).proposals[0];
  assert.equal(p.status, "review");
  assert.equal(p.conflict, "confirmed_and_no_match");
});

test("an exact display-name alias is found when the formal full name differs (no DOB)", () => {
  const formal = { transfermarkt_id: 10, full_name: "Thibaut Nicolas Marc Courtois", display_name: "Thibaut Courtois", date_of_birth: "1992-05-11" };
  const p = reconcilePlayerIdentities([sm(1, "Thibaut Courtois", null, { current_club: "" })], [formal]).proposals[0];
  assert.deepEqual(candidateIds(p), ["10"]);
  assert.ok(p.candidates[0].evidence.includes("name_exact"));
  assert.deepEqual(p.candidates[0].matched_name, { sm: "Thibaut Courtois", tm: "Thibaut Courtois" });
  assert.equal(p.status, "review");
});

test("an exact display-name alias earns full name points when DOB matches", () => {
  const formal = { transfermarkt_id: 10, full_name: "Thibaut Nicolas Marc Courtois", display_name: "Thibaut Courtois", date_of_birth: "1992-05-11" };
  const p = reconcilePlayerIdentities([sm(1, "Thibaut Courtois", "1992-05-11", { current_club: "" })], [formal]).proposals[0];
  assert.equal(p.candidates[0].score, 85);
  assert.equal(p.status, "proposed_auto");
});

test("alias arrays on either side are indexed and compared", () => {
  const p = reconcilePlayerIdentities(
    [sm(1, "Rodrigo Hernández Cascante", null, { aliases: ["Rodri"], current_club: "" })],
    [{ transfermarkt_id: 10, name: "Rodri", date_of_birth: "1996-06-22" }]
  ).proposals[0];
  assert.deepEqual(candidateIds(p), ["10"]);
  assert.deepEqual(p.candidates[0].matched_name, { sm: "Rodri", tm: "Rodri" });
});

// --- Codex review regressions, round 2 ---

test("confirmed plus unresolved forces review regardless of order", () => {
  const sms = [sm(1, "Alex Smith", "2000-01-02")];
  const tms = [tm(10, "Alex Smith", "2000-01-02")];
  const confirmed = { sm_player_data_id: "1", transfermarkt_id: "10", status: "confirmed", reviewer: "A" };
  const parked = { sm_player_data_id: "1", status: "unresolved", reviewer: "B" };
  for (const decisions of [[confirmed, parked], [parked, confirmed]]) {
    const p = reconcilePlayerIdentities(sms, tms, decisions).proposals[0];
    assert.equal(p.status, "review");
    assert.equal(p.conflict, "confirmed_and_unresolved");
    assert.equal(p.reviewed_transfermarkt_id, undefined);
    assert.deepEqual(p.conflicting_decisions.map(d => d.reviewer).sort(), ["A", "B"]);
  }
});

test("a nickname-only match is discoverable without a DOB", () => {
  const tmRow = { transfermarkt_id: 10, full_name: "Vinícius José Paixão de Oliveira Júnior", nickname: "Vinícius Júnior", date_of_birth: "2000-07-12" };
  const p = reconcilePlayerIdentities([sm(1, "Vinicius Junior", null, { current_club: "" })], [tmRow]).proposals[0];
  assert.deepEqual(candidateIds(p), ["10"]);
  assert.ok(p.candidates[0].evidence.includes("name_exact"));
  assert.equal(p.candidates[0].matched_name.tm, "Vinícius Júnior");
  assert.equal(p.status, "review");
});

test("TM nicknames arrays are indexed too", () => {
  const tmRow = { transfermarkt_id: 10, full_name: "Ederson Santana de Moraes", nicknames: ["Ederson"], date_of_birth: "1993-08-17" };
  const p = reconcilePlayerIdentities([sm(1, "Ederson", "1993-08-17", { current_club: "" })], [tmRow]).proposals[0];
  assert.deepEqual(candidateIds(p), ["10"]);
  assert.equal(p.status, "proposed_auto");
});

// --- Codex review regression, round 3 ---

test("a conflicted player's confirmation still blocks another player's confirmation of that TM identity", () => {
  const sms = [sm(1, "Alex Smith", "2000-01-02"), sm(2, "Alex Smith", "2000-01-02")];
  const tms = [tm(10, "Alex Smith", "2000-01-02"), tm(11, "Alex Smith", "2000-01-02")];
  const decisions = [
    { sm_player_data_id: "1", transfermarkt_id: "10", status: "confirmed" },
    { sm_player_data_id: "1", transfermarkt_id: "11", status: "confirmed" }, // player 1 is self-contradictory
    { sm_player_data_id: "2", transfermarkt_id: "10", status: "confirmed" }  // player 2 claims TM 10 too
  ];
  for (const ordered of [decisions, [...decisions].reverse()]) {
    const [p1, p2] = reconcilePlayerIdentities(sms, tms, ordered).proposals;
    assert.equal(p1.status, "review");
    assert.deepEqual([...p1.conflict_reasons].sort(), ["conflicting_confirmations", "tm_confirmed_for_multiple_sm"]);
    assert.equal(p2.status, "review");
    assert.deepEqual(p2.conflict_reasons, ["tm_confirmed_for_multiple_sm"]);
    assert.equal(p2.reviewed_transfermarkt_id, undefined);
  }
});

test("a conflicted player's confirmation still blocks an automatic proposal for that TM identity", () => {
  const sms = [sm(1, "Alex Smith", "2000-01-02"), sm(2, "Jamie Brown", "1999-03-04")];
  const tms = [tm(10, "Jamie Brown", "1999-03-04")];
  const decisions = [
    { sm_player_data_id: "1", transfermarkt_id: "10", status: "confirmed" },
    { sm_player_data_id: "1", status: "unresolved" }
  ];
  const [p1, p2] = reconcilePlayerIdentities(sms, tms, decisions).proposals;
  assert.equal(p1.status, "review");
  assert.equal(p2.status, "review");
  assert.equal(p2.conflict, "tm_claimed_by_human_decision");
});

// --- Codex review regressions, round 4 ---

test("an empty earlier ID field does not hide a populated later one", () => {
  const smRow = { player_data_id: "", playerDataId: 123, name: "Alex Smith", date_of_birth: "2000-01-02", current_club: "Club A" };
  const tmRow = { transfermarkt_id: "", tm_id: 10, name: "Alex Smith", date_of_birth: "2000-01-02", current_club: "Club A" };
  const p = reconcilePlayerIdentities([smRow], [tmRow]).proposals[0];
  assert.equal(p.sm_player_data_id, "123");
  assert.deepEqual(candidateIds(p), ["10"]);
  assert.equal(p.status, "proposed_auto");
});

test("the same SM identity repeated across rows is not a duplicate claim", () => {
  const rows = [sm(1, "Alex Smith", "2000-01-02"), sm(1, "Alex Smith", "2000-01-02")];
  const r = reconcilePlayerIdentities(rows, [tm(10, "Alex Smith", "2000-01-02")]);
  assert.deepEqual(statuses(r), ["proposed_auto", "proposed_auto"]);
});

test("repeated rows for one SM identity that disagree go to review", () => {
  const rows = [sm(1, "Alex Smith", "2000-01-02"), sm(1, "Jamie Brown", "1999-03-04")];
  const tms = [tm(10, "Alex Smith", "2000-01-02"), tm(11, "Jamie Brown", "1999-03-04")];
  const r = reconcilePlayerIdentities(rows, tms);
  assert.deepEqual(statuses(r), ["review", "review"]);
  assert.ok(r.proposals.every(p => p.conflict === "inconsistent_sm_rows"));
});

test("distinct SM identities colliding on one TM player still go to review", () => {
  const rows = [sm(1, "Alex Smith", "2000-01-02"), sm(1, "Alex Smith", "2000-01-02"), sm(2, "Alex Smith", "2000-01-02")];
  const r = reconcilePlayerIdentities(rows, [tm(10, "Alex Smith", "2000-01-02")]);
  assert.ok(r.proposals.every(p => p.status === "review" && p.conflict === "duplicate_tm_claim"));
});
