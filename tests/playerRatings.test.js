import test from "node:test";
import assert from "node:assert/strict";
import { buildDerivedPlayer } from "../derived/players/index.js";
import { abilityFromMarketValue } from "../derived/ratings/ability.js";
import { effectiveMatchRating, formFromOutput } from "../derived/ratings/form.js";
import { potentialBand } from "../derived/ratings/potential.js";
import { reputationFromCareerStature } from "../derived/ratings/reputation.js";

test("ability uses published market value anchors", () => {
  assert.equal(abilityFromMarketValue(250_000_000), 99);
  assert.equal(abilityFromMarketValue(80_000_000), 90);
  assert.equal(abilityFromMarketValue(20_000_000), 80);
  assert.equal(abilityFromMarketValue(25_000), 45);
  assert.equal(abilityFromMarketValue(10_000), 40);
});

test("ability interpolates between anchors", () => {
  assert.equal(abilityFromMarketValue(13_000_000), 78);
  assert.equal(abilityFromMarketValue(19_000_000), 80);
});

test("potential creates forward projection for young players", () => {
  const band = potentialBand({ ability: 70, age: 17, valueGrowthPercent: 60 });
  assert.equal(band.lower, 77);
  assert.equal(band.upper, 100);
  assert.equal(band.label, "Forward Projection");
});

test("reputation follows career stature and caps formula", () => {
  assert.equal(reputationFromCareerStature({ careerStature: 86, caps: 70 }), 87);
});

test("form and effective match rating are bounded", () => {
  const form = formFromOutput({ ability: 80, role: "forward", actualPer90: 0.99, leagueTier: "S", minutes: 900, maxWindowMinutes: 900 });
  assert.equal(form, 4);
  assert.equal(effectiveMatchRating({ ability: 80, form }), 82);
});

test("builds a derived player from normalised provider data plus market evidence", () => {
  const derived = buildDerivedPlayer({
    player: {
      provider: "api-football",
      providerPlayerId: "123",
      name: "Example Player",
      age: 21,
      nationality: "England",
      position: "Attacker",
      team: { providerTeamId: "50", name: "Example FC" },
      league: { providerLeagueId: "39", name: "Premier League", country: "England", season: 2025 },
      appearances: 10,
      minutes: 900,
      goals: 9,
      assists: 1
    },
    marketValue: 20_000_000,
    leagueTier: "S",
    caps: 12,
    valueGrowthPercent: 50
  });

  assert.equal(derived.id, "provider:api-football:123");
  assert.equal(derived.ratings.ability, 80);
  assert.equal(derived.ratings.form, 4);
  assert.equal(derived.ratings.effectiveMatchRating, 82);
  assert.equal(derived.ratings.reputation, 74);
  assert.equal(derived.ratings.potential.upper > derived.ratings.ability, true);
});
