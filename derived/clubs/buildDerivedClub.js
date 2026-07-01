import { createManagerSlot } from "./managerSlots.js";

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(1));
}

function topAverage(players, count) {
  return average(players
    .map((player) => player.ratings?.effectiveMatchRating ?? player.ratings?.ability)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)
    .slice(0, count));
}

function normaliseRole(position) {
  const value = String(position ?? "").toLowerCase();
  if (value.includes("keeper")) return "goalkeeper";
  if (value.includes("defender")) return "defence";
  if (value.includes("attacker") || value.includes("forward")) return "attack";
  return "midfield";
}

function roleAverage(players, role) {
  return topAverage(players.filter((player) => normaliseRole(player.position) === role), role === "goalkeeper" ? 1 : 5);
}

function reputationFromStanding(standing, squadOverall) {
  const rank = standing?.rank;
  if (!rank) return Math.round(squadOverall);
  return Math.round(Math.max(40, squadOverall + (12 / Math.max(rank, 1))));
}

export function buildDerivedClub(input) {
  const team = input.team?.team ?? input.team;
  const venue = input.team?.venue ?? null;
  const players = input.players ?? [];
  const standing = input.standing ?? null;
  const coachRows = input.coachRows ?? [];
  const teamCount = input.teamCount ?? null;

  if (!team?.id) throw new Error("team id is required.");

  const overall = topAverage(players, 16);
  const startingStrength = topAverage(players, 11);
  const depth = topAverage(players, 25);
  const averageAge = average(players.map((player) => Number(player.age)));

  const club = {
    id: `provider:api-football:${team.id}`,
    source: {
      provider: "api-football",
      providerTeamId: String(team.id)
    },
    name: team.name,
    country: team.country ?? null,
    founded: team.founded ?? null,
    national: team.national ?? false,
    venue,
    squad: {
      playerIds: players.map((player) => player.id),
      size: players.length,
      averageAge,
      overall,
      startingStrength,
      depth,
      attack: roleAverage(players, "attack"),
      midfield: roleAverage(players, "midfield"),
      defence: roleAverage(players, "defence"),
      goalkeeper: roleAverage(players, "goalkeeper")
    },
    leagueContext: standing
      ? {
          rank: standing.rank,
          points: standing.points,
          goalsDiff: standing.goalsDiff,
          form: standing.form ?? null
        }
      : null,
    coaching: {
      providerRows: coachRows,
      currentCoachName: coachRows[0]?.name ?? null
    },
    reputation: reputationFromStanding(standing, overall),
    financialPower: Math.round(Math.max(40, Math.min(100, overall + depth / 8))),
    youthStrength: Math.round(Math.max(35, Math.min(100, averageAge ? 100 - averageAge : 60))),
    managerSlot: null
  };

  return {
    ...club,
    managerSlot: createManagerSlot({ club, standing, teamCount })
  };
}

export function buildDerivedClubs(inputs) {
  if (!Array.isArray(inputs)) throw new Error("buildDerivedClubs requires an array.");
  return inputs.map(buildDerivedClub);
}
