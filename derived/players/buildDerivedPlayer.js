import { abilityFromMarketValue } from "../ratings/ability.js";
import { effectiveMatchRating, formFromOutput } from "../ratings/form.js";
import { potentialBand } from "../ratings/potential.js";
import { reputationFromCareerStature } from "../ratings/reputation.js";
import { marketEvidence } from "./estimateMarketValue.js";

function roleFromPosition(position) {
  const value = String(position ?? "").toLowerCase();
  if (value.includes("attacker") || value.includes("forward")) return "forward";
  if (value.includes("defender") || value.includes("keeper")) return "defence";
  return "midfield";
}

function outputPer90(player) {
  const minutes = Number(player.minutes ?? 0);
  if (!minutes) return 0;
  return ((Number(player.goals ?? 0) + Number(player.assists ?? 0)) / minutes) * 90;
}

export function buildDerivedPlayer(input) {
  const player = input.player;
  const leagueTier = input.leagueTier ?? "S";
  const estimatedMarket = marketEvidence(player, { leagueTier });
  const marketValue = input.marketValue ?? estimatedMarket.marketValue;
  const marketValueEvidence = input.marketValue
    ? { evidenceQuality: "provided", method: "input-market-value" }
    : estimatedMarket;
  const peakAbility = input.peakAbility;
  const caps = input.caps ?? 0;
  const valueGrowthPercent = input.valueGrowthPercent ?? 0;
  const maxWindowMinutes = input.maxWindowMinutes ?? 900;

  if (!player) throw new Error("player is required.");

  const ability = abilityFromMarketValue(marketValue);
  const role = roleFromPosition(player.position);
  const form = formFromOutput({
    ability,
    role,
    actualPer90: outputPer90(player),
    leagueTier,
    minutes: player.minutes ?? 0,
    maxWindowMinutes
  });
  const peak = peakAbility ?? ability;

  return {
    id: `provider:${player.provider}:${player.providerPlayerId}`,
    source: {
      provider: player.provider,
      providerPlayerId: player.providerPlayerId
    },
    name: player.name,
    age: player.age,
    nationality: player.nationality,
    position: player.position,
    team: player.team,
    league: player.league,
    marketValue,
    ratings: {
      ability,
      potential: potentialBand({
        ability,
        age: player.age,
        peakAbility: peak,
        valueGrowthPercent
      }),
      form,
      reputation: reputationFromCareerStature({ careerStature: peak, caps }),
      effectiveMatchRating: effectiveMatchRating({ ability, form })
    },
    evidence: {
      minutes: player.minutes ?? 0,
      appearances: player.appearances ?? 0,
      goals: player.goals ?? 0,
      assists: player.assists ?? 0,
      leagueTier,
      caps,
      valueGrowthPercent,
      marketValueEvidence
    }
  };
}

export function buildDerivedPlayers(inputs) {
  if (!Array.isArray(inputs)) throw new Error("buildDerivedPlayers requires an array.");
  return inputs.map(buildDerivedPlayer);
}
