import test from "node:test";
import assert from "node:assert/strict";
import { clubSimilarity, matchIdentity, nameSimilarity, normaliseClub, normaliseName } from "../src/ratingModel/playerIdentity.js";

test("normalises common aliases", () => {
  assert.equal(normaliseName("Beto"), "gomes beto");
  assert.equal(normaliseName("M. Ødegaard"), "martin odegaard");
  assert.equal(normaliseClub("Brighton"), "brighton hove albion");
  assert.equal(normaliseClub("AFC Bournemouth"), "bournemouth");
});

test("matches identity before club", () => {
  const targets = [
    { name: "Jack Grealish", club: "Manchester City", rating: 91 },
    { name: "Bruno Fernandes", club: "Manchester United", rating: 94 }
  ];

  const result = matchIdentity({ name: "J. Grealish", club: "Everton" }, targets);

  assert.equal(result.match.name, "Jack Grealish");
  assert.equal(result.match.clubMismatch, true);
  assert.equal(result.match.confidence, 0.98);
});

test("uses club only as a tiebreaker", () => {
  const targets = [
    { name: "Ismaïla Sarr", club: "Crystal Palace", rating: 89 },
    { name: "Mamadou Sarr", club: "Chelsea", rating: 87 },
    { name: "Pape Matar Sarr", club: "Tottenham Hotspur", rating: 88 }
  ];

  const result = matchIdentity({ name: "P. Sarr", club: "Tottenham" }, targets, { minConfidence: 0.85 });

  assert.equal(result.match.name, "Pape Matar Sarr");
  assert.equal(result.match.reason, "club-tiebreak");
});

test("scores reordered and club aliases", () => {
  assert.ok(nameSimilarity("Alisson Becker", "Becker Alisson") >= 0.99);
  assert.ok(clubSimilarity("Newcastle", "Newcastle United") >= 0.8);
});
