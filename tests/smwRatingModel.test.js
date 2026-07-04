import test from "node:test";
import assert from "node:assert/strict";
import { formatSmwRatingModelReport, marketValueFromRow, trainSmwRatingModel } from "../src/ratingModel/trainSmwModel.js";

function player(id, name, club, position, ability, age, minutes, goals, assists) {
  return {
    id,
    name,
    age,
    position,
    team: { name: club },
    appearances: 30,
    lineups: 25,
    minutes,
    goals,
    assists,
    yellowCards: 2,
    redCards: 0,
    ratings: { ability, effectiveMatchRating: ability }
  };
}

const players = [
  player("p1", "Alpha One", "Alpha", "Attacker", 90, 25, 2800, 25, 8),
  player("p2", "Alpha Two", "Alpha", "Midfielder", 88, 26, 2600, 8, 12),
  player("p3", "Alpha Three", "Alpha", "Defender", 86, 27, 2500, 2, 3),
  player("p4", "Beta One", "Beta", "Attacker", 84, 24, 2400, 13, 5),
  player("p5", "Beta Two", "Beta", "Midfielder", 82, 28, 2200, 4, 8),
  player("p6", "Beta Three", "Beta", "Defender", 80, 30, 2100, 1, 2),
  player("p7", "Gamma One", "Gamma", "Attacker", 78, 23, 1800, 8, 4),
  player("p8", "Gamma Two", "Gamma", "Midfielder", 76, 25, 1700, 2, 5),
  player("p9", "Gamma Three", "Gamma", "Defender", 74, 29, 1600, 0, 1),
  player("p10", "Delta One", "Delta", "Goalkeeper", 83, 31, 3000, 0, 0),
  player("p11", "Delta Two", "Delta", "Attacker", 72, 22, 900, 3, 1),
  player("p12", "Delta Three", "Delta", "Midfielder", 70, 21, 800, 1, 2),
  player("p13", "Epsilon One", "Epsilon", "Defender", 68, 24, 700, 0, 0),
  player("p14", "Epsilon Two", "Epsilon", "Attacker", 66, 20, 600, 2, 0),
  player("p15", "Epsilon Three", "Epsilon", "Midfielder", 64, 19, 500, 0, 1),
  player("p16", "Zeta One", "Zeta", "Goalkeeper", 62, 28, 400, 0, 0),
  player("p17", "Zeta Two", "Zeta", "Defender", 60, 27, 300, 0, 0),
  player("p18", "Zeta Three", "Zeta", "Attacker", 58, 18, 200, 1, 0),
  player("p19", "Eta One", "Eta", "Midfielder", 56, 22, 100, 0, 0)
];

const pack = { players: Object.fromEntries(players.map((row) => [row.id, row])) };
const targets = players.map((row) => ({ name: row.name, club: row.team.name, smwRating: row.ratings.ability + 4 }));

test("trains SMW rating model from matched players", () => {
  const model = trainSmwRatingModel(pack, targets, { ridge: 10 });

  assert.equal(model.meta.examples, players.length);
  assert.ok(model.metrics.meanAbsoluteError < 2);
  assert.ok(model.coefficients.intercept !== undefined);
  assert.equal(model.predictions.length, players.length);
});

test("parses Transfermarkt market values", () => {
  assert.equal(marketValueFromRow({ market_value: "€80.00m" }), 80000000);
  assert.equal(marketValueFromRow({ market_value: "€750k" }), 750000);
  assert.equal(marketValueFromRow({ market_value_eur: 12500000 }), 12500000);
});

test("uses Transfermarkt market value rows when provided", () => {
  const marketValueRows = [
    { player_name: "Alpha One", squad: "Alpha", market_value: "€100.00m" },
    { player_name: "Alpha Two", squad: "Alpha", market_value: "€60.00m" },
    { player_name: "Beta One", squad: "Beta", market_value: "€12.50m" }
  ];
  const model = trainSmwRatingModel(pack, targets, { ridge: 10, marketValueRows });

  assert.equal(model.meta.marketValueRows, 3);
  assert.equal(model.meta.marketValueMatches, 3);
  assert.ok(model.featureNames.includes("logMarketValue"));
  assert.equal(model.predictions.find((row) => row.playerName === "Alpha One").marketValueMatched, true);
});

test("formats SMW rating model report", () => {
  const model = trainSmwRatingModel(pack, targets, { ridge: 10 });
  const text = formatSmwRatingModelReport(model);

  assert.match(text, /# SMW Rating Model/);
  assert.match(text, /Coefficients/);
  assert.match(text, /Market value coverage/);
  assert.match(text, /Biggest misses/);
});
