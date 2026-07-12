import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalLeagueRepairPlan,
  renderCanonicalLeagueRepairMarkdown
} from "../scripts/plan-canonical-league-repair.js";

const audit = {
  generated_at: "2026-07-12T09:15:14.443Z",
  season: "2026-27",
  leagues: [
    {
      key: "bundesliga",
      league: "Bundesliga",
      club_reports: [
        { club_id: "3", club_name: "1. FC Köln", imported_players: 0, published_players: 0 },
        { club_id: "41", club_name: "Hamburger SV", imported_players: 1, published_players: 1 },
        { club_id: "27", club_name: "Bayern Munich", imported_players: 30, published_players: 30 }
      ]
    },
    {
      key: "premier_league",
      league: "Premier League",
      club_reports: [
        { club_id: "11", club_name: "Arsenal FC", imported_players: 27, published_players: 27 }
      ]
    }
  ]
};

test("selects only missing and thin canonical clubs", () => {
  const plan = buildCanonicalLeagueRepairPlan(audit, { thinThreshold: 18 });

  assert.deepEqual(plan.club_ids, ["3", "41"]);
  assert.equal(plan.summary.clubs, 2);
  assert.equal(plan.summary.missing_clubs, 1);
  assert.equal(plan.summary.thin_clubs, 1);
  assert.equal(plan.summary.estimated_player_shortfall_to_threshold, 35);
  assert.deepEqual(plan.clubs.map((club) => club.reason), ["missing", "thin"]);
});

test("can restrict repair to selected leagues and missing clubs", () => {
  const plan = buildCanonicalLeagueRepairPlan(audit, {
    leagueKeys: ["bundesliga"],
    includeThin: false,
    thinThreshold: 18
  });

  assert.deepEqual(plan.club_ids, ["3"]);
  assert.equal(plan.summary.missing_clubs, 1);
  assert.equal(plan.summary.thin_clubs, 0);
});

test("renders an auditable targeted fetch plan", () => {
  const plan = buildCanonicalLeagueRepairPlan(audit, { thinThreshold: 18 });
  const markdown = renderCanonicalLeagueRepairMarkdown(plan);

  assert.match(markdown, /1\. FC Köln \(TM club 3\)/);
  assert.match(markdown, /Hamburger SV \(TM club 41\)/);
  assert.match(markdown, /Club IDs: 3,41/);
  assert.doesNotMatch(markdown, /Bayern Munich/);
});
