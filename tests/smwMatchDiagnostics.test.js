import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseSmwPlayerMatches, formatSmwMatchDiagnostics } from "../src/ratingModel/smwMatchDiagnostics.js";

const pack = {
  players: {
    salah: {
      id: "salah",
      name: "Mohamed Salah",
      team: { name: "Liverpool" },
      ratings: { ability: 88.5 }
    },
    bruno: {
      id: "bruno",
      name: "Bruno Fernandes",
      team: { name: "Manchester Utd" },
      ratings: { ability: 85 }
    },
    joao: {
      id: "joao",
      name: "Joao Pedro",
      team: { name: "Brighton" },
      ratings: { ability: 89.5 }
    }
  }
};

const targets = [
  { name: "Mohamed Salah", club: "Liverpool", smwRating: 94 },
  { name: "Bruno Fernandes", club: "Manchester United", smwRating: 94 },
  { name: "João Pedro", club: "Brighton", smwRating: 89 }
];

test("diagnoses exact and likely SMW player matches", () => {
  const report = diagnoseSmwPlayerMatches(pack, targets, { limit: 10, suggestionLimit: 3 });

  assert.equal(report.summary.packPlayers, 3);
  assert.equal(report.summary.targetPlayers, 3);
  assert.equal(report.summary.matched, 3);
  assert.equal(report.summary.unmatchedPackPlayers, 0);
  assert.equal(report.unmatchedPlayers.length, 0);
});

test("formats SMW match diagnostics", () => {
  const report = diagnoseSmwPlayerMatches(pack, targets, { limit: 10, suggestionLimit: 3 });
  const text = formatSmwMatchDiagnostics(report);

  assert.match(text, /# SMW Match Diagnostics/);
  assert.match(text, /Matched:/);
  assert.match(text, /Unmatched API players/);
  assert.match(text, /Bruno Fernandes/);
});
