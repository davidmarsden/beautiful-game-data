import test from "node:test";
import assert from "node:assert/strict";
import { clubSimilarity, matchIdentity, nameSimilarity, normaliseClub, normaliseName } from "../src/ratingModel/playerIdentity.js";

test("normalises common aliases", () => {
  assert.equal(normaliseName("Beto"), "gomes beto");
  assert.equal(normaliseName("M. Ødegaard"), "martin odegaard");
  assert.equal(normaliseName("Pascal Groß"), "pascal gross");
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

test("uses club as supporting evidence for ambiguous surnames", () => {
  const targets = [
    { name: "Ismaïla Sarr", club: "Crystal Palace", rating: 89 },
    { name: "Mamadou Sarr", club: "Chelsea", rating: 87 },
    { name: "Pape Matar Sarr", club: "Tottenham Hotspur", rating: 88 }
  ];

  const result = matchIdentity({ name: "P. Sarr", club: "Tottenham" }, targets, { minConfidence: 0.85 });

  assert.equal(result.match.name, "Pape Matar Sarr");
  assert.ok(["initial-surname", "club-tiebreak"].includes(result.match.reason));
  assert.equal(result.match.clubScore, 1);
});

test("scores reordered and club aliases", () => {
  assert.ok(nameSimilarity("Alisson Becker", "Becker Alisson") >= 0.99);
  assert.ok(nameSimilarity("Pascal Gross", "Pascal Groß") >= 0.99);
  assert.ok(clubSimilarity("Newcastle", "Newcastle United") >= 0.8);
});
