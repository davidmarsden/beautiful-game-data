function firstStatistic(apiPlayer) {
  return Array.isArray(apiPlayer.statistics) && apiPlayer.statistics.length > 0
    ? apiPlayer.statistics[0]
    : {};
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function normaliseApiFootballPlayer(apiPlayer, context = {}) {
  const player = apiPlayer.player ?? {};
  const stats = firstStatistic(apiPlayer);

  return {
    provider: "api-football",
    providerPlayerId: String(player.id),
    name: player.name ?? player.firstname ?? "Unknown Player",
    age: player.age ?? null,
    nationality: player.nationality ?? null,
    position: stats.games?.position ?? null,
    team: stats.team
      ? {
          providerTeamId: String(stats.team.id),
          name: stats.team.name
        }
      : null,
    league: stats.league
      ? {
          providerLeagueId: String(stats.league.id),
          name: stats.league.name,
          country: stats.league.country,
          season: stats.league.season
        }
      : null,
    appearances: numberOrZero(stats.games?.appearences),
    lineups: numberOrZero(stats.games?.lineups),
    minutes: numberOrZero(stats.games?.minutes),
    goals: numberOrZero(stats.goals?.total),
    assists: numberOrZero(stats.goals?.assists),
    yellowCards: numberOrZero(stats.cards?.yellow),
    redCards: numberOrZero(stats.cards?.red),
    importedAt: context.importedAt ?? null
  };
}

export function normaliseApiFootballPlayers(apiPlayers, context = {}) {
  if (!Array.isArray(apiPlayers)) {
    throw new Error("normaliseApiFootballPlayers requires an array.");
  }

  return apiPlayers.map((apiPlayer) => normaliseApiFootballPlayer(apiPlayer, context));
}
