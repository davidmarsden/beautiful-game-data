const EXPECTED_OUTPUT = Object.freeze({
  forward: [
    { ability: 60, expected: 0.20 },
    { ability: 70, expected: 0.35 },
    { ability: 80, expected: 0.55 },
    { ability: 90, expected: 0.85 },
    { ability: 100, expected: 1.10 }
  ],
  midfield: [
    { ability: 60, expected: 0.10 },
    { ability: 70, expected: 0.18 },
    { ability: 80, expected: 0.30 },
    { ability: 90, expected: 0.45 },
    { ability: 100, expected: 0.60 }
  ],
  defence: [
    { ability: 60, expected: 0.22 },
    { ability: 70, expected: 0.30 },
    { ability: 80, expected: 0.38 },
    { ability: 90, expected: 0.45 },
    { ability: 100, expected: 0.55 }
  ]
});

export const LEAGUE_WEIGHTS = Object.freeze({
  S: 1.0,
  A: 0.85,
  B: 0.70,
  C: 0.55,
  D: 0.40
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function interpolateExpected(ability, role) {
  const table = EXPECTED_OUTPUT[role] ?? EXPECTED_OUTPUT.midfield;

  if (ability <= table[0].ability) return Math.max(table[0].expected, 0.10);
  if (ability >= table.at(-1).ability) return Math.max(table.at(-1).expected, 0.10);

  for (let index = 0; index < table.length - 1; index += 1) {
    const low = table[index];
    const high = table[index + 1];

    if (ability >= low.ability && ability <= high.ability) {
      const ratio = (ability - low.ability) / (high.ability - low.ability);
      return Math.max(low.expected + (high.expected - low.expected) * ratio, 0.10);
    }
  }

  return 0.10;
}

export function formFromOutput({ ability, role = "midfield", actualPer90 = 0, leagueTier = "S", minutes = 0, maxWindowMinutes = 900 }) {
  const currentAbility = Number(ability);
  if (!Number.isFinite(currentAbility)) throw new Error("ability is required for Form.");

  const expected = interpolateExpected(currentAbility, role);
  const leagueWeight = LEAGUE_WEIGHTS[leagueTier] ?? LEAGUE_WEIGHTS.S;
  const minutesConfidence = clamp(Number(minutes) / Number(maxWindowMinutes || 900), 0, 1);
  const formRaw = 5 * ((Number(actualPer90) - expected) / expected) * leagueWeight * minutesConfidence;

  return clamp(Math.round(formRaw), -5, 5);
}

export function effectiveMatchRating({ ability, form }) {
  return Number((Number(ability) + (Number(form) * 0.5)).toFixed(1));
}
