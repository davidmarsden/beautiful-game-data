export const ABILITY_ANCHORS = Object.freeze([
  { value: 250_000_000, ability: 99 },
  { value: 200_000_000, ability: 97 },
  { value: 150_000_000, ability: 95 },
  { value: 120_000_000, ability: 93 },
  { value: 80_000_000, ability: 90 },
  { value: 50_000_000, ability: 86 },
  { value: 30_000_000, ability: 83 },
  { value: 20_000_000, ability: 80 },
  { value: 12_000_000, ability: 77 },
  { value: 7_000_000, ability: 74 },
  { value: 4_000_000, ability: 71 },
  { value: 2_000_000, ability: 68 },
  { value: 1_000_000, ability: 64 },
  { value: 500_000, ability: 60 },
  { value: 200_000, ability: 55 },
  { value: 75_000, ability: 50 },
  { value: 25_000, ability: 45 }
].sort((a, b) => a.value - b.value));

export function abilityFromMarketValue(marketValue) {
  const value = Number(marketValue);

  if (!Number.isFinite(value) || value < 25_000) return 40;

  const anchors = ABILITY_ANCHORS;

  if (value >= anchors.at(-1).value) return anchors.at(-1).ability;

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const low = anchors[index];
    const high = anchors[index + 1];

    if (value >= low.value && value <= high.value) {
      const ratio = (Math.log(value) - Math.log(low.value)) / (Math.log(high.value) - Math.log(low.value));
      return Math.round(low.ability + (high.ability - low.ability) * ratio);
    }
  }

  return 40;
}
