function capsScoreFromCaps(caps = 0) {
  const value = Number(caps);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value <= 10) return 20;
  if (value <= 25) return 40;
  if (value <= 50) return 60;
  if (value <= 80) return 78;
  if (value <= 120) return 90;
  return 100;
}

export function reputationFromCareerStature({ careerStature, caps = 0 }) {
  const stature = Number(careerStature);
  if (!Number.isFinite(stature)) {
    throw new Error("careerStature is required for Reputation.");
  }

  const capsScore = capsScoreFromCaps(caps);
  return Math.min(100, Math.round(20 + (0.56 * stature) + (0.24 * capsScore)));
}

export { capsScoreFromCaps };
