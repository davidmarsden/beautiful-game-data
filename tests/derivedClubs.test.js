import test from "node:test";
import assert from "node:assert/strict";
import { buildDerivedClub } from "../derived/clubs/index.js";

const players = [
  { id: "p1", age: 25, position: "Attacker", ratings: { ability: 88, effectiveMatchRating: 89 } },
  { id: "p2", age: 26, position: "Attacker", ratings: { ability: 85, effectiveMatchRating: 85 } },
  { id: "p3", age: 24, position: "Midfielder", ratings: { ability: 86, effectiveMatchRating: 87 } },
  { id: "p4", age: 28, position: "Defender", ratings: { ability: 84, effectiveMatchRating: 84 } },
  { id: "p5", age: 30, position: "Goalkeeper", ratings: { ability: 83, effectiveMatchRating: 83 } }
];

test("builds a derived club from team, squad, standing and coach evidence", () => {
  const club = buildDerivedClub({
    team: {
      team: { id: 50, name: "Example FC", country: "England", founded: 1900, national: false },
      venue: { name: "Example Ground" }
    },
    players,
    standing: {
      rank: 4,
      points: 65,
      goalsDiff: 20,
      form: "WWDLW",
      team: { id: 50 }
    },
    coachRows: [{ name: "Example Coach" }],
    teamCount: 20
  });

  assert.equal(club.id, "provider:api-football:50");
  assert.equal(club.name, "Example FC");
  assert.equal(club.squad.size, 5);
  assert.equal(club.squad.attack, 87);
  assert.equal(club.squad.goalkeeper, 83);
  assert.equal(club.coaching.currentCoachName, "Example Coach");
  assert.equal(club.managerSlot.status, "vacant");
  assert.equal(club.managerSlot.controller.type, "caretaker-ai");
  assert.equal(club.managerSlot.permissions.transfers, true);
  assert.equal(club.managerSlot.boardExpectation.category, "continental-places");
});

test("survival expectation is assigned to lower-ranked clubs", () => {
  const club = buildDerivedClub({
    team: { team: { id: 51, name: "Survival FC" } },
    players,
    standing: { rank: 18, team: { id: 51 } },
    teamCount: 20
  });

  assert.equal(club.managerSlot.boardExpectation.category, "survival");
  assert.equal(club.managerSlot.caretaker.active, true);
});
