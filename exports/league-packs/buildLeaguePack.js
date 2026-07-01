function byId(rows) {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

function compactFixture(fixtureRow) {
  const fixture = fixtureRow.fixture ?? {};
  const teams = fixtureRow.teams ?? {};
  const goals = fixtureRow.goals ?? {};
  const score = fixtureRow.score ?? {};

  return {
    id: `provider:api-football:${fixture.id}`,
    source: {
      provider: "api-football",
      providerFixtureId: String(fixture.id)
    },
    date: fixture.date ?? null,
    status: fixture.status ?? null,
    venue: fixture.venue ?? null,
    homeTeamId: teams.home?.id ? `provider:api-football:${teams.home.id}` : null,
    awayTeamId: teams.away?.id ? `provider:api-football:${teams.away.id}` : null,
    goals,
    score
  };
}

function compactStanding(standingRow) {
  return {
    teamId: standingRow.team?.id ? `provider:api-football:${standingRow.team.id}` : null,
    rank: standingRow.rank,
    points: standingRow.points,
    goalsDiff: standingRow.goalsDiff,
    form: standingRow.form ?? null,
    all: standingRow.all ?? null,
    home: standingRow.home ?? null,
    away: standingRow.away ?? null
  };
}

function standingRows(standingsSnapshot) {
  const first = standingsSnapshot.rows?.[0];
  return first?.league?.standings?.[0] ?? [];
}

export function buildLeaguePack(input) {
  const clubs = input.clubs ?? [];
  const players = input.players ?? [];
  const fixtures = input.fixtures ?? [];
  const standings = standingRows(input.standingsSnapshot ?? { rows: [] }).map(compactStanding);
  const source = input.source ?? {};

  return {
    meta: {
      version: "league-pack-v0.1",
      createdAt: input.createdAt ?? new Date().toISOString(),
      source,
      counts: {
        clubs: clubs.length,
        players: players.length,
        fixtures: fixtures.length,
        standings: standings.length,
        managerSlots: clubs.length
      }
    },
    clubs: byId(clubs),
    players: byId(players),
    managerSlots: Object.fromEntries(clubs.map((club) => [club.id, club.managerSlot])),
    fixtures: fixtures.map(compactFixture),
    standings
  };
}
