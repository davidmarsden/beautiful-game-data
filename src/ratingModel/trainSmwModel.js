function round(value, digits = 4) {
  return Number(Number(value ?? 0).toFixed(digits));
}

function normaliseName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function key(name, club = "") {
  const nameKey = normaliseName(name);
  const clubKey = normaliseName(club);
  return clubKey ? `${nameKey}|${clubKey}` : nameKey;
}

function targetIndex(targetRows) {
  const byNameClub = new Map();
  const byName = new Map();
  for (const row of targetRows ?? []) {
    const name = nameFromTarget(row);
    const club = clubFromTarget(row);
    const rating = ratingFromTarget(row);
    if (!name || rating <= 0) continue;
    const target = { name, club, rating, raw: row };
    if (club) byNameClub.set(key(name, club), target);
    if (!byName.has(key(name))) byName.set(key(name), target);
  }
  return { byNameClub, byName };
}

function playerClub(player) {
  return player.team?.name ?? player.clubName ?? player.teamName ?? "";
}

function matchTarget(player, index) {
  const club = playerClub(player);
  if (club && index.byNameClub.has(key(player.name, club))) return index.byNameClub.get(key(player.name, club));
  return index.byName.get(key(player.name)) ?? null;
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

export function trainSmwRatingModel(pack, targetRows, options = {}) {
  const featureNames = options.features ?? DEFAULT_FEATURES;
  const index = targetIndex(targetRows);
  const examples = [];

  for (const player of Object.values(pack.players ?? {})) {
    const target = matchTarget(player, index);
    if (!target) continue;
    const features = playerFeatureObject(player);
    examples.push({
      playerId: player.id,
      playerName: player.name,
      clubName: playerClub(player),
      positionGroup: positionGroup(player),
      targetRating: target.rating,
      features
    });
  }

  if (examples.length < featureNames.length + 2) {
    throw new Error(`Not enough matched players to train model: ${examples.length} examples for ${featureNames.length} features.`);
  }

  const x = examples.map((example) => featureNames.map((name) => number(example.features[name])));
  const y = examples.map((example) => example.targetRating);
  const coefficients = fitRidgeRegression(x, y, number(options.ridge ?? 1));

  const predictions = examples.map((example) => {
    const predictedRating = predict(example.features, coefficients, featureNames);
    const error = predictedRating - example.targetRating;
    return {
      playerId: example.playerId,
      playerName: example.playerName,
      clubName: example.clubName,
      positionGroup: example.positionGroup,
      targetRating: example.targetRating,
      predictedRating: round(predictedRating, 2),
      error: round(error, 3),
      absoluteError: round(Math.abs(error), 3)
    };
  });

  const absoluteErrors = predictions.map((row) => row.absoluteError);
  const errors = predictions.map((row) => row.error);

  return {
    meta: {
      version: "smw-rating-model-v0.1",
      trainedAt: new Date().toISOString(),
      examples: examples.length,
      targetRows: targetRows.length,
      ridge: number(options.ridge ?? 1)
    },
    featureNames,
    coefficients: Object.fromEntries(featureNames.map((name, index) => [name, round(coefficients[index], 8)])),
    metrics: {
      meanError: round(mean(errors), 3),
      meanAbsoluteError: round(mean(absoluteErrors), 3),
      medianAbsoluteError: round(median(absoluteErrors), 3),
      maxAbsoluteError: round(Math.max(...absoluteErrors), 3),
      score: round(Math.max(0, 100 - mean(absoluteErrors) * 15), 2)
    },
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
    "",
    "Coefficients:"
  ];

  for (const [name, value] of Object.entries(model.coefficients)) lines.push(`- ${name}: ${value}`);

  lines.push("", "Biggest misses:", "Player                   Club                     Pos Pred SMW Diff");
  for (const row of model.biggestMisses) {
    lines.push([
      row.playerName.padEnd(24, " "),
      String(row.clubName ?? "").padEnd(24, " "),
      row.positionGroup.padEnd(3, " "),
      String(row.predictedRating).padStart(5, " "),
      String(row.targetRating).padStart(3, " "),
      String(row.error).padStart(6, " ")
    ].join(" "));
  }

  return lines.join("\n");
}

export { DEFAULT_FEATURES, playerFeatureObject };
