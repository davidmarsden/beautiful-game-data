import test from "node:test";
import assert from "node:assert/strict";
import { buildLeaguePack } from "../exports/league-packs/index.js";

const club = {
  id: "provider:api-football:50",
  name: "Example FC",
  managerSlot: {
    clubId: "provider:api-football:50",
    status: "vacant",
    controller: { type: "caretaker-ai" }
  }
};

const player = {
  id: "provider:api-football:123",
  name: "Example Player",
  team: { providerTeamId: "50" }
};

const fixture = {
  fixture: {
    id: 999,
    date: "2026-07-01T20:00:00+00:00",
    status: { short: "NS" },
    venue: { name: "Example Ground" }
  },
  teams: {
    home: { id: 50, name: "Example FC" },
    away: { id: 51, name: "Away FC" }
  },
  goals: { home: null, away: null },
  score: { fulltime: { home: null, away: null } }
};

const standingsSnapshot = {
  rows: [{
    league: {
      standings: [[
        { rank: 1, points: 80, goalsDiff: 40, form: "WWWWW", team: { id: 50 } }
      ]]
    }
  }]
};

test("builds an engine-ready league pack", () => {
  const pack = buildLeaguePack({
    clubs: [club],
    players: [player],
    fixtures: [fixture],
    standingsSnapshot,
    source: { league: "39", season: "2025" },
    createdAt: "2026-07-01T00:00:00.000Z"
  });

  assert.equal(pack.meta.version, "league-pack-v0.1");
  assert.equal(pack.meta.counts.clubs, 1);
  assert.equal(pack.meta.counts.players, 1);
  assert.equal(pack.meta.counts.fixtures, 1);
  assert.equal(pack.clubs[club.id].name, "Example FC");
  assert.equal(pack.players[player.id].name, "Example Player");
  assert.equal(pack.managerSlots[club.id].status, "vacant");
  assert.equal(pack.fixtures[0].homeTeamId, "provider:api-football:50");
  assert.equal(pack.standings[0].teamId, "provider:api-football:50");
});
