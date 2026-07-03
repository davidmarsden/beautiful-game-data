import { matchIdentity, playerClubKey, playerIdentityKey, targetIdentityKey } from "./playerIdentity.js";

function round(value, digits = 4) {
  return Number(Number(value ?? 0).toFixed(digits));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ratingFromTarget(row) {
  return number(row.smwRating ?? row.soccerwikiRating ?? row.targetRating ?? row.rating ?? row.rt, 0);
}

function clubFromTarget(row) {
  return row.club ?? row.clubName ?? row.team ?? row.teamName ?? "";
}

function nameFromTarget(row) {
  return row.name ?? row.playerName ?? row.player ?? "";
}

function targetIndex(targetRows) {
  const byNameClub = new Map();
  const byName = new Map();
  const targets = [];
  for (const row of targetRows ?? []) {
    const name = nameFromTarget(row);
    const club = clubFromTarget(row);
    const rating = ratingFromTarget(row);
    if (!name || rating <= 0) continue;
    const target = { name, club, rating, raw: row };
    target.identityKey = targetIdentityKey(target);
    targets.push(target);
    if (club) byNameClub.set(playerClubKey(name, club), target);
    if (!byName.has(playerIdentityKey(name))) byName.set(playerIdentityKey(name), target);
  }
  return { byNameClub, byName, targets };
}

function playerClub(player) {
  return player.team?.name ?? player.clubName ?? player.teamName ?? "";
}

function candidateMatches(player, index, options = {}) {
  const name = player.name;
  const club = playerClub(player);
  const candidates = [];

  if (club && index.byNameClub.has(playerClubKey(name, club))) {
    const target = index.byNameClub.get(playerClubKey(name, club));
    candidates.push({ ...target, confidence: 1, reason: "exact-name-club", clubMismatch: false });
  }

  candidates.push(...matchIdentity({ name, club }, index.targets, { ...options, minConfidence: 2 }).candidates);

  if (index.byName.has(playerIdentityKey(name))) {
    const target = index.byName.get(playerIdentityKey(name));
    candidates.push({ ...target, confidence: 1, reason: "exact-name", clubMismatch: true });
  }

  const byTarget = new Map();
  for (const candidate of candidates) {
    const key = targetIdentityKey(candidate);
    const current = byTarget.get(key);
    if (!current || candidate.confidence > current.confidence || candidate.clubScore > current.clubScore) {
      byTarget.set(key, { ...candidate, identityKey: key });
    }
  }

  return [...byTarget.values()].sort((a, b) => b.confidence - a.confidence || b.clubScore - a.clubScore || b.nameScore - a.nameScore || String(a.name).localeCompare(String(b.name)));
}

function selectOneToOneMatches(players, index, options = {}) {
  const proposals = [];
  for (const player of players) {
    for (const target of candidateMatches(player, index, options)) {
      if (Number(target.confidence ?? 0) < Number(options.minTrainingConfidence ?? 0.95)) continue;
      if (options.excludeClubMismatches && target.clubMismatch) continue;
      proposals.push({
        player,
        target,
        targetKey: targetIdentityKey(target),
        confidence: target.confidence ?? 1,
        clubScore: target.clubScore ?? 0,
        nameScore: target.nameScore ?? 0
      });
    }
  }

  proposals.sort((a, b) => b.confidence - a.confidence || b.clubScore - a.clubScore || b.nameScore - a.nameScore || playerRating(b.player) - playerRating(a.player));

  const usedPlayers = new Set();
  const usedTargets = new Set();
  const matches = [];
  for (const proposal of proposals) {
    if (usedPlayers.has(proposal.player.id) || usedTargets.has(proposal.targetKey)) continue;
    usedPlayers.add(proposal.player.id);
    usedTargets.add(proposal.targetKey);
    matches.push(proposal);
  }
  return matches;
}

function playerRating(player) {
  return Number(player.ratings?.effectiveMatchRating ?? player.ratings?.ability ?? player.ability ?? player.rating ?? 0);
}

function positionGroup(player) {
  const value = String(player.position ?? player.profile?.position ?? player.roles?.[0] ?? "").toLowerCase();
  if (value.includes("goalkeeper") || value === "gk") return "GK";
  if (value.includes("defender") || value.startsWith("d")) return "DEF";
  if (value.includes("midfielder") || value.startsWith("m")) return "MID";
  if (value.includes("attacker") || value.includes("forward") || value.includes("winger") || value.startsWith("f") || value.startsWith("am")) return "ATT";
  return "UNK";
}

function playerFeatureObject(player) {
  const appearances = number(player.appearances ?? player.statistics?.games?.appearences ?? player.statistics?.games?.appearances);
  const lineups = number(player.lineups ?? player.statistics?.games?.lineups);
  const minutes = number(player.minutes ?? player.statistics?.games?.minutes);
  const goals = number(player.goals ?? player.statistics?.goals?.total);
  const assists = number(player.assists ?? player.statistics?.goals?.assists);
  const age = number(player.age ?? player.profile?.age, 0);
  const yellowCards = number(player.yellowCards ?? player.statistics?.cards?.yellow);
  const redCards = number(player.redCards ?? player.statistics?.cards?.red);
  const currentAbility = number(player.ratings?.ability ?? player.ability ?? player.rating);
  const effectiveRating = number(player.ratings?.effectiveMatchRating ?? currentAbility);
  const group = positionGroup(player);

  return {
    intercept: 1,
    currentAbility,
    effectiveRating,
    age,
    ageSquared: age ? age * age : 0,
    appearances,
    starts: lineups,
    minutesPer3000: minutes / 3000,
    startShare: appearances ? lineups / appearances : 0,
    goalsPer90: minutes ? goals * 90 / minutes : 0,
    assistsPer90: minutes ? assists * 90 / minutes : 0,
    cardsPer90: minutes ? (yellowCards + redCards * 2) * 90 / minutes : 0,
    isGK: group === "GK" ? 1 : 0,
    isDEF: group === "DEF" ? 1 : 0,
    isMID: group === "MID" ? 1 : 0,
    isATT: group === "ATT" ? 1 : 0
  };
}

const DEFAULT_FEATURES = [
  "intercept",
  "currentAbility",
  "effectiveRating",
  "age",
  "ageSquared",
  "appearances",
  "starts",
  "minutesPer3000",
  "startShare",
  "goalsPer90",
  "assistsPer90",
  "cardsPer90",
  "isGK",
  "isDEF",
  "isMID",
  "isATT"
];

const DEFAULT_CALIBRATION_FEATURES = [
  "intercept",
  "rawPrediction",
  "rawPredictionSquared",
  "currentAbility",
  "effectiveRating",
  "abilityOver85",
  "abilityOver88",
  "abilityOver90",
  "effectiveOver85",
  "effectiveOver88",
  "effectiveOver90",
  "isGK",
  "isDEF",
  "isMID",
  "isATT"
];

function matrixTranspose(matrix) {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

function matrixMultiply(a, b) {
  return a.map((row) => b[0].map((_, column) => row.reduce((sum, value, index) => sum + value * b[index][column], 0)));
}

function identity(size) {
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => row === column ? 1 : 0));
}

function invert(matrix) {
  const size = matrix.length;
  const augmented = matrix.map((row, index) => [...row, ...identity(size)[index]]);

  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];

    const divisor = augmented[pivot][pivot];
    if (Math.abs(divisor) < 1e-12) throw new Error("Rating model matrix is singular; increase ridge or reduce features.");
    for (let column = 0; column < size * 2; column += 1) augmented[pivot][column] /= divisor;

    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = 0; column < size * 2; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }

  return augmented.map((row) => row.slice(size));
}

function fitRidgeRegression(x, y, ridge = 0.1) {
  const xt = matrixTranspose(x);
  const xtx = matrixMultiply(xt, x);
  const regularised = xtx.map((row, rowIndex) => row.map((value, columnIndex) => {
    if (rowIndex === columnIndex && rowIndex !== 0) return value + ridge;
    return value;
  }));
  const xty = matrixMultiply(xt, y.map((value) => [value]));
  return matrixMultiply(invert(regularised), xty).map((row) => row[0]);
}

function predict(features, coefficients, featureNames) {
  return featureNames.reduce((sum, name, index) => sum + number(features[name]) * coefficients[index], 0);
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const clean = [...values].sort((a, b) => a - b);
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function calibrationFeatureObject(example, rawPrediction) {
  const currentAbility = number(example.features.currentAbility);
  const effectiveRating = number(example.features.effectiveRating);

  return {
    intercept: 1,
    rawPrediction,
    rawPredictionSquared: rawPrediction * rawPrediction,
    currentAbility,
    effectiveRating,
    abilityOver85: Math.max(0, currentAbility - 85),
    abilityOver88: Math.max(0, currentAbility - 88),
    abilityOver90: Math.max(0, currentAbility - 90),
    effectiveOver85: Math.max(0, effectiveRating - 85),
    effectiveOver88: Math.max(0, effectiveRating - 88),
    effectiveOver90: Math.max(0, effectiveRating - 90),
    isGK: number(example.features.isGK),
    isDEF: number(example.features.isDEF),
    isMID: number(example.features.isMID),
    isATT: number(example.features.isATT)
  };
}

function fitPredictionCalibration(examples, rawPredictions, options = {}) {
  const featureNames = options.calibrationFeatures ?? DEFAULT_CALIBRATION_FEATURES;
  const x = examples.map((example, index) => featureNames.map((name) => number(calibrationFeatureObject(example, rawPredictions[index])[name])));
  const y = examples.map((example) => example.targetRating);
  const coefficients = fitRidgeRegression(x, y, number(options.calibrationRidge ?? 0.5));
  return { featureNames, coefficients };
}

function calibratedPrediction(example, rawPrediction, calibration) {
  if (!calibration) return rawPrediction;
  const features = calibrationFeatureObject(example, rawPrediction);
  return predict(features, calibration.coefficients, calibration.featureNames);
}

function predictionRows(examples, rawPredictions, calibration = null) {
  return examples.map((example, index) => {
    const rawPrediction = rawPredictions[index];
    const predictedRating = calibratedPrediction(example, rawPrediction, calibration);
    const error = predictedRating - example.targetRating;
    return {
      playerId: example.playerId,
      playerName: example.playerName,
      clubName: example.clubName,
      positionGroup: example.positionGroup,
      targetRating: example.targetRating,
      rawPrediction: round(rawPrediction, 2),
      predictedRating: round(predictedRating, 2),
      error: round(error, 3),
      absoluteError: round(Math.abs(error), 3),
      matchConfidence: example.matchConfidence,
      matchReason: example.matchReason,
      clubMismatch: example.clubMismatch
    };
  });
}

function metricSummary(predictions) {
  const absoluteErrors = predictions.map((row) => row.absoluteError);
  const errors = predictions.map((row) => row.error);
  return {
    meanError: round(mean(errors), 3),
    meanAbsoluteError: round(mean(absoluteErrors), 3),
    medianAbsoluteError: round(median(absoluteErrors), 3),
    maxAbsoluteError: round(Math.max(...absoluteErrors), 3),
    score: round(Math.max(0, 100 - mean(absoluteErrors) * 15), 2)
  };
}

export function trainSmwRatingModel(pack, targetRows, options = {}) {
  const featureNames = options.features ?? DEFAULT_FEATURES;
  const index = targetIndex(targetRows);
  const examples = [];
  const matchOptions = {
    minConfidence: Number(options.minConfidence ?? 0.95),
    minTrainingConfidence: Number(options.minTrainingConfidence ?? 0.95),
    clubTieBreakConfidence: Number(options.clubTieBreakConfidence ?? 0.85),
    excludeClubMismatches: Boolean(options.excludeClubMismatches)
  };

  const selectedMatches = selectOneToOneMatches(Object.values(pack.players ?? {}), index, matchOptions);

  for (const { player, target } of selectedMatches) {
    const features = playerFeatureObject(player);
    examples.push({
      playerId: player.id,
      playerName: player.name,
      clubName: playerClub(player),
      positionGroup: positionGroup(player),
      targetRating: target.rating,
      matchConfidence: target.confidence ?? 1,
      matchReason: target.reason ?? "exact-name",
      clubMismatch: Boolean(target.clubMismatch),
      features
    });
  }

  if (examples.length < featureNames.length + 2) {
    throw new Error(`Not enough matched players to train model: ${examples.length} examples for ${featureNames.length} features.`);
  }

  const x = examples.map((example) => featureNames.map((name) => number(example.features[name])));
  const y = examples.map((example) => example.targetRating);
  const coefficients = fitRidgeRegression(x, y, number(options.ridge ?? 1));
  const rawPredictions = examples.map((example) => predict(example.features, coefficients, featureNames));
  const rawPredictionRows = predictionRows(examples, rawPredictions, null);
  const calibrationEnabled = options.calibrate !== false;
  const calibration = calibrationEnabled ? fitPredictionCalibration(examples, rawPredictions, options) : null;
  const predictions = predictionRows(examples, rawPredictions, calibration);
  const metrics = metricSummary(predictions);
  const rawMetrics = metricSummary(rawPredictionRows);

  return {
    meta: {
      version: "smw-rating-model-v0.4",
      trainedAt: new Date().toISOString(),
      examples: examples.length,
      targetRows: targetRows.length,
      ridge: number(options.ridge ?? 1),
      calibrationRidge: calibrationEnabled ? number(options.calibrationRidge ?? 0.5) : null,
      calibrated: calibrationEnabled,
      minTrainingConfidence: Number(options.minTrainingConfidence ?? 0.95),
      excludeClubMismatches: Boolean(options.excludeClubMismatches)
    },
    featureNames,
    coefficients: Object.fromEntries(featureNames.map((name, index) => [name, round(coefficients[index], 8)])),
    calibration: calibration ? {
      featureNames: calibration.featureNames,
      coefficients: Object.fromEntries(calibration.featureNames.map((name, index) => [name, round(calibration.coefficients[index], 8)]))
    } : null,
    rawMetrics,
    metrics,
    biggestMisses: [...predictions].sort((a, b) => b.absoluteError - a.absoluteError || a.playerName.localeCompare(b.playerName)).slice(0, 20),
    predictions: predictions.sort((a, b) => b.targetRating - a.targetRating || a.playerName.localeCompare(b.playerName))
  };
}

export function formatSmwRatingModelReport(model) {
  const lines = [
    "# SMW Rating Model",
    `Examples: ${model.meta.examples}/${model.meta.targetRows}`,
    `Score: ${model.metrics.score}/100`,
    `Mean error: ${model.metrics.meanError}`,
    `Mean absolute error: ${model.metrics.meanAbsoluteError}`,
    `Median absolute error: ${model.metrics.medianAbsoluteError}`,
    `Max absolute error: ${model.metrics.maxAbsoluteError}`,
    `Calibrated: ${model.meta.calibrated ? "yes" : "no"}`,
    ""
  ];

  if (model.rawMetrics) {
    lines.push(
      "Raw model:",
      `- Mean absolute error: ${model.rawMetrics.meanAbsoluteError}`,
      `- Median absolute error: ${model.rawMetrics.medianAbsoluteError}`,
      `- Max absolute error: ${model.rawMetrics.maxAbsoluteError}`,
      ""
    );
  }

  lines.push("Coefficients:");
  for (const [name, value] of Object.entries(model.coefficients)) lines.push(`- ${name}: ${value}`);

  if (model.calibration) {
    lines.push("", "Calibration coefficients:");
    for (const [name, value] of Object.entries(model.calibration.coefficients)) lines.push(`- ${name}: ${value}`);
  }

  lines.push("", "Biggest misses:", "Player                   Club                     Pos Raw  Pred SMW Diff Conf Reason");
  for (const row of model.biggestMisses) {
    lines.push([
      row.playerName.padEnd(24, " "),
      String(row.clubName ?? "").padEnd(24, " "),
      row.positionGroup.padEnd(3, " "),
      String(row.rawPrediction ?? "").padStart(4, " "),
      String(row.predictedRating).padStart(5, " "),
      String(row.targetRating).padStart(3, " "),
      String(row.error).padStart(6, " "),
      String(row.matchConfidence ?? "").padStart(4, " "),
      row.matchReason ?? ""
    ].join(" "));
  }

  return lines.join("\n");
}

export { DEFAULT_FEATURES, DEFAULT_CALIBRATION_FEATURES, playerFeatureObject };
