const PEAK_GAIN_BY_AGE = Object.freeze({
  16: 16,
  17: 14,
  18: 12,
  19: 10,
  20: 8,
  21: 6,
  22: 4,
  23: 3
});

const WIDTH_BY_AGE = Object.freeze({
  16: 15,
  17: 14,
  18: 12,
  19: 10,
  20: 8,
  21: 6,
  22: 5,
  23: 4
});

const TYPICAL_ABILITY_BY_AGE = Object.freeze({
  16: 48,
  17: 52,
  18: 56,
  19: 60,
  20: 63,
  21: 66,
  22: 69,
  23: 72
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function valueGrowthModifier(growthPercent = 0) {
  const growth = Number(growthPercent);
  if (!Number.isFinite(growth)) return 0;
  if (growth > 100) return 0.4;
  if (growth >= 50) return 0.2;
  if (growth >= -25) return 0;
  if (growth >= -50) return -0.2;
  return -0.3;
}

function precocityModifier({ ability, age }) {
  const typical = TYPICAL_ABILITY_BY_AGE[age];
  if (!typical) return 0;

  const gap = ability - typical;
  if (gap >= 8) return 0.3;
  if (gap >= 3) return 0.15;
  if (gap >= -2) return 0;
  if (gap >= -7) return -0.1;
  return -0.2;
}

export function potentialBand({ ability, age, peakAbility = ability, valueGrowthPercent = 0 }) {
  const currentAbility = Number(ability);
  const currentAge = Number(age);
  const peak = Number(peakAbility);

  if (!Number.isFinite(currentAbility)) throw new Error("ability is required for Potential.");
  if (!Number.isFinite(currentAge)) throw new Error("age is required for Potential.");

  if (currentAge >= 30) {
    return { lower: peak, upper: peak, label: "Peak" };
  }

  if (currentAge >= 26 && peak > currentAbility + 3) {
    return { lower: peak, upper: peak, label: "Post-Peak" };
  }

  if (currentAge >= 26) {
    return {
      lower: clamp(currentAbility - 1, 1, 100),
      upper: clamp(currentAbility + 1, 1, 100),
      label: "Mature"
    };
  }

  if (currentAge >= 24) {
    return {
      lower: clamp(currentAbility - 2, 1, 100),
      upper: clamp(currentAbility + 2, 1, 100),
      label: "Late Development"
    };
  }

  const peakGain = PEAK_GAIN_BY_AGE[currentAge] ?? 0;
  const width = WIDTH_BY_AGE[currentAge] ?? 0;
  const trajectoryFactor = clamp(
    1 + valueGrowthModifier(valueGrowthPercent) + precocityModifier({ ability: currentAbility, age: currentAge }),
    0.5,
    1.5
  );
  const centre = currentAbility + (peakGain * trajectoryFactor);

  return {
    lower: clamp(Math.round(centre - width), currentAbility, 100),
    upper: clamp(Math.round(centre + width), currentAbility, 100),
    label: "Forward Projection"
  };
}
