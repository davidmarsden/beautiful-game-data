import test from "node:test";
import assert from "node:assert/strict";
import { ApiFootballClient } from "../importers/api-football/client.js";
import { API_FOOTBALL_CONFIG, getApiFootballKey } from "../importers/api-football/config.js";
import { normaliseApiFootballPlayer, normaliseApiFootballPlayers } from "../importers/api-football/normalise.js";
import { createDataSnapshot } from "../importers/snapshots.js";

const sampleApiPlayer = {
  player: { id: 123, name: "Example Player", age: 21, nationality: "England" },
  statistics: [{
    team: { id: 50, name: "Example FC" },
    league: { id: 39, name: "Premier League", country: "England", season: 2026 },
    games: { appearences: 12, lineups: 8, minutes: 740, position: "Midfielder" },
    goals: { total: 3, assists: 2 },
    cards: { yellow: 1, red: 0 }
  }]
};

test("API-Football config exposes provider metadata", () => {
  assert.equal(API_FOOTBALL_CONFIG.provider, "api-football");
  assert.equal(API_FOOTBALL_CONFIG.requiredEnvVars.includes("API_FOOTBALL_KEY"), true);
});

test("API-Football key is read from env-like object", () => {
  assert.equal(getApiFootballKey({ API_FOOTBALL_KEY: "abc" }), "abc");
  assert.equal(getApiFootballKey({}), null);
});

test("normalises an API-Football player", () => {
  const player = normaliseApiFootballPlayer(sampleApiPlayer, { importedAt: "2026-07-01T00:00:00.000Z" });
  assert.equal(player.provider, "api-football");
  assert.equal(player.providerPlayerId, "123");
  assert.equal(player.name, "Example Player");
  assert.equal(player.position, "Midfielder");
  assert.equal(player.team.name, "Example FC");
  assert.equal(player.minutes, 740);
  assert.equal(player.goals, 3);
  assert.equal(player.assists, 2);
});

test("normalises a player array", () => {
  const players = normaliseApiFootballPlayers([sampleApiPlayer]);
  assert.equal(players.length, 1);
  assert.equal(players[0].providerPlayerId, "123");
});

test("creates a data snapshot", () => {
  const rows = normaliseApiFootballPlayers([sampleApiPlayer]);
  const snapshot = createDataSnapshot({ provider: "api-football", version: "test-v0", rows });
  assert.equal(snapshot.meta.provider, "api-football");
  assert.equal(snapshot.meta.rowCount, 1);
});

test("client builds requests with API key", async () => {
  const calls = [];
  const client = new ApiFootballClient({
    apiKey: "secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, async json() { return { response: [sampleApiPlayer] }; } };
    }
  });
  const response = await client.playersByLeagueSeason({ leagueId: 39, season: 2026, page: 2 });
  assert.equal(response.length, 1);
  assert.equal(calls[0].url.searchParams.get("league"), "39");
  assert.equal(calls[0].options.headers["x-apisports-key"], "secret");
});
