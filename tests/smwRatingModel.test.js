import test from "node:test";
import assert from "node:assert/strict";
import { formatSmwRatingModelReport, marketValueFromRow, trainSmwRatingModel } from "../src/ratingModel/trainSmwModel.js";

const POSITIONS = ["Attacker", "Midfielder", "Defender", "Goalkeeper"];
const CLUBS = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"];

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

function syntheticPlayer(index) {
  const position = POSITIONS[index % POSITIONS.length];
  const club = CLUBS[index % CLUBS.length];
  const ability = 92 - index;
  const age = 19 + (index % 16);
  const minutes = Math.max(250, 3000 - index * 65);
  const attackingBias = position === "Attacker" ? 1 : position === "Midfielder" ? 0.45 : 0.12;
  const goals = Math.round(Math.max(0, (34 - index) * attackingBias));
  const assists = Math.round(Math.max(0, (18 - index * 0.35) * (position === "Defender" ? 0.2 : 0.55)));
  return player(`p${index + 1}`, `Player ${String(index + 1).padStart(2, "0")}`, club, position, ability, age, minutes, goals, assists);
}

const players = Array.from({ length: 40 }, (_, index) => syntheticPlayer(index));
const pack = { players: Object.fromEntries(players.map((row) => [row.id, row])) };
const targets = players.map((row, index) => ({
  name: row.name,
  club: row.team.name,
  smwRating: row.ratings.ability + 3 + (index % 5 === 0 ? 1 : 0)
}));

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
    { player_name: "Player 01", squad: "Alpha", market_value: "€100.00m" },
    { player_name: "Player 02", squad: "Beta", market_value: "€60.00m" },
    { player_name: "Player 05", squad: "Epsilon", market_value: "€12.50m" }
  ];
  const model = trainSmwRatingModel(pack, targets, { ridge: 10, marketValueRows });

  assert.equal(model.meta.marketValueRows, 3);
  assert.equal(model.meta.marketValueMatches, 3);
  assert.ok(model.featureNames.includes("logMarketValue"));
  assert.equal(model.predictions.find((row) => row.playerName === "Player 01").marketValueMatched, true);
});

test("formats SMW rating model report", () => {
  const model = trainSmwRatingModel(pack, targets, { ridge: 10 });
  const text = formatSmwRatingModelReport(model);

  assert.match(text, /# SMW Rating Model/);
  assert.match(text, /Coefficients/);
  assert.match(text, /Market value coverage/);
  assert.match(text, /Biggest misses/);
});
