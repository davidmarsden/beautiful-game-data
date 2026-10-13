import test from "node:test";
import assert from "node:assert/strict";
import { validateIdentityDecisions } from "../src/identity/validateIdentityDecisions.js";

const confirm = (sm, tm) => ({ sm_player_data_id: sm, transfermarkt_id: tm, status: "confirmed" });
const rejectPair = (sm, tm) => ({ sm_player_data_id: sm, transfermarkt_id: tm, status: "rejected" });
const noMatch = sm => ({ sm_player_data_id: sm, status: "rejected" });
const park = sm => ({ sm_player_data_id: sm, status: "unresolved" });
const outcome = (decisions, sm = "1") => validateIdentityDecisions(decisions).players.get(sm);

// Every combination of decisions that cannot all be true is a conflict.
const conflicts = [
  ["two confirmations", [confirm("1", "10"), confirm("1", "11")], "conflicting_confirmations"],
  ["confirmation and pair rejection", [confirm("1", "10"), rejectPair("1", "10")], "confirmed_and_rejected"],
  ["confirmation and no-match", [confirm("1", "10"), noMatch("1")], "confirmed_and_no_match"],
  ["confirmation and unresolved", [confirm("1", "10"), park("1")], "confirmed_and_unresolved"],
  ["no-match and unresolved", [noMatch("1"), park("1")], "no_match_and_unresolved"],
  ["unknown status", [{ sm_player_data_id: "1", status: "maybe" }], "invalid_decision"],
  ["confirmation without TM id", [{ sm_player_data_id: "1", status: "confirmed" }], "invalid_decision"]
];
for (const [label, decisions, reason] of conflicts) {
  test(`conflict: ${label}`, () => {
    for (const ordered of [decisions, [...decisions].reverse()]) {
      const p = outcome(ordered);
      assert.equal(p.outcome, "conflict");
      assert.ok(p.reasons.includes(reason));
      assert.equal(p.records.length, decisions.length);
    }
  });
}

// Compatible combinations are not conflicts.
const consistent = [
  ["single confirmation", [confirm("1", "10")], "match"],
  ["repeated confirmation", [confirm("1", "10"), confirm("1", "10")], "match"],
  ["confirmation and rejection of a different pair", [confirm("1", "10"), rejectPair("1", "11")], "match"],
  ["no-match and pair rejection", [noMatch("1"), rejectPair("1", "10")], "no_match"],
  ["unresolved and pair rejection", [park("1"), rejectPair("1", "10")], "unresolved"],
  ["pair rejections only", [rejectPair("1", "10"), rejectPair("1", "11")], "open"]
];
for (const [label, decisions, expected] of consistent) {
  test(`consistent: ${label}`, () => {
    assert.equal(outcome(decisions).outcome, expected);
  });
}

test("decisions without an SM id are reported, not dropped", () => {
  const r = validateIdentityDecisions([{ transfermarkt_id: "10", status: "confirmed" }, confirm("1", "10")]);
  assert.equal(r.unattributed.length, 1);
  assert.equal(r.summary.unattributed, 1);
  assert.equal(r.players.get("1").outcome, "match");
});

test("conflicts on one player do not affect another", () => {
  const r = validateIdentityDecisions([confirm("1", "10"), park("1"), confirm("2", "20")]);
  assert.equal(r.players.get("1").outcome, "conflict");
  assert.equal(r.players.get("2").outcome, "match");
  assert.equal(r.summary.conflicts, 1);
});

test("one TM identity confirmed for two SM players is a conflict for both", () => {
  const r = validateIdentityDecisions([confirm("1", "10"), confirm("2", "10")]);
  for (const sid of ["1", "2"]) {
    const p = r.players.get(sid);
    assert.equal(p.outcome, "conflict");
    assert.deepEqual(p.reasons, ["tm_confirmed_for_multiple_sm"]);
    assert.deepEqual(p.shared_transfermarkt_ids, ["10"]);
  }
});

test("cross-player collisions count confirmations from players already in conflict", () => {
  const r = validateIdentityDecisions([confirm("1", "10"), park("1"), confirm("2", "10")]);
  assert.ok(r.players.get("1").reasons.includes("tm_confirmed_for_multiple_sm"));
  assert.equal(r.players.get("2").outcome, "conflict");
  assert.deepEqual([...r.confirmations_by_tm.get("10")].sort(), ["1", "2"]);
});
