const LEAGUE_TIER_MULTIPLIER = Object.freeze({
  S: 1.0,
  A: 0.75,
  B: 0.5,
  C: 0.32,
  D: 0.18
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ageMultiplier(age) {
  const value = Number(age);
  if (!Number.isFinite(value)) return 0.6;
  if (value <= 18) return 0.9;
  if (value <= 21) return 1.25;
  if (value <= 24) return 1.35;
  if (value <= 27) return 1.2;
  if (value <= 30) return 0.95;
  if (value <= 33) return 0.55;
  return 0.25;
}

function outputMultiplier(player) {
  const minutes = Number(player.minutes ?? 0);
  if (!minutes) return 0.85;

  const goals = Number(player.goals ?? 0);
  const assists = Number(player.assists ?? 0);
  const outputPer90 = ((goals + assists) / minutes) * 90;

  return clamp(0.85 + outputPer90, 0.85, 2.2);
}

export function estimateMarketValue(player, options = {}) {
  const minutes = Number(player.minutes ?? 0);
  const appearances = Number(player.appearances ?? 0);
  const leagueTier = options.leagueTier ?? "S";
  const tierMultiplier = LEAGUE_TIER_MULTIPLIER[leagueTier] ?? LEAGUE_TIER_MULTIPLIER.S;

  const minutesValue = Math.sqrt(Math.max(minutes, 0)) * 750_000;
  const appearanceValue = Math.sqrt(Math.max(appearances, 0)) * 350_000;
  const base = 500_000 + minutesValue + appearanceValue;
  const value = base * tierMultiplier * ageMultiplier(player.age) * outputMultiplier(player);

  return Math.round(clamp(value, 50_000, 250_000_000) / 25_000) * 25_000;
}

export function marketEvidence(player, options = {}) {
  return {
    marketValue: estimateMarketValue(player, options),
    evidenceQuality: "estimated",
    method: "minutes-age-output-league-tier-v0.1"
  };
}
