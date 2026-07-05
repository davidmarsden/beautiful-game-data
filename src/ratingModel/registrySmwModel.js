function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 4) {
  return Number(Number(value ?? 0).toFixed(digits));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function identity(size) {
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => row === column ? 1 : 0));
}

function transpose(matrix) {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

function multiply(a, b) {
  return a.map((row) => b[0].map((_, column) => row.reduce((sum, value, index) => sum + value * b[index][column], 0)));
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
    if (Math.abs(divisor) < 1e-12) throw new Error("Registry SMW model matrix is singular; increase ridge or reduce features.");
    for (let column = 0; column < size * 2; column += 1) augmented[pivot][column] /= divisor;

    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = 0; column < size * 2; column += 1) augmented[row][column] -= factor * augmented[pivot][column];
    }
  }

  return augmented.map((row) => row.slice(size));
}

function fitRidgeRegression(x, y, ridge = 1) {
  const xt = transpose(x);
  const xtx = multiply(xt, x);
  const regularised = xtx.map((row, rowIndex) => row.map((value, columnIndex) => {
    if (rowIndex === columnIndex && rowIndex !== 0) return value + ridge;
    return value;
  }));
  const xty = multiply(xt, y.map((value) => [value]));
  return multiply(invert(regularised), xty).map((row) => row[0]);
}

function predict(features, coefficients, featureNames) {
  return featureNames.reduce((sum, name, index) => sum + number(features[name]) * coefficients[index], 0);
}

function positionGroup(position) {
  const value = String(position ?? "").toLowerCase();
  if (value.includes("gk") || value.includes("goalkeeper")) return "GK";
  if (value.startsWith("d") || value.includes("back") || value.includes("defender")) return "DEF";
  if (value.startsWith("m") || value.includes("midfield")) return "MID";
  if (value.startsWith("f") || value.startsWith("am") || value.includes("wing") || value.includes("forward") || value.includes("striker")) return "ATT";
  return "UNK";
}

function marketTrend(record) {
  const current = number(record.market_value_eur, 0);
  const previous = number(record.previous_market_value_eur, 0);
  if (!current || !previous) return 0;
  return (current - previous) / previous;
}

function featuresFor(registryRow, tmRow) {
  const age = number(tmRow.age ?? registryRow.age, 0);
  const marketValue = number(tmRow.market_value_eur, 0);
  const previousValue = number(tmRow.previous_market_value_eur, 0);
  const highestValue = number(tmRow.highest_market_value_eur, 0);
  const marketValueMillions = marketValue / 1_000_000;
  const highestValueMillions = highestValue / 1_000_000;
  const group = positionGroup(tmRow.position || registryRow.primary_position);

  return {
    intercept: 1,
    age,
    ageSquared: age * age,
    marketValueMillions,
    logMarketValue: marketValue > 0 ? Math.log10(marketValue) : 0,
    marketValueOver10m: Math.max(0, marketValueMillions - 10),
    marketValueOver25m: Math.max(0, marketValueMillions - 25),
    marketValueOver50m: Math.max(0, marketValueMillions - 50),
    marketValueOver80m: Math.max(0, marketValueMillions - 80),
    highestValueMillions,
    logHighestValue: highestValue > 0 ? Math.log10(highestValue) : 0,
    previousValueMillions: previousValue / 1_000_000,
    marketTrend: marketTrend(tmRow),
    internationalCaps: number(tmRow.international_caps, 0),
    internationalGoals: number(tmRow.international_goals, 0),
    totalTransferFeesMillions: number(tmRow.total_transfer_fees_eur, 0) / 1_000_000,
    heightCm: number(tmRow.height_cm, 0),
    hasMarketValue: marketValue > 0 ? 1 : 0,
    isGK: group === "GK" ? 1 : 0,
    isDEF: group === "DEF" ? 1 : 0,
    isMID: group === "MID" ? 1 : 0,
    isATT: group === "ATT" ? 1 : 0
  };
}

const DEFAULT_FEATURES = [
  "intercept",
  "age",
  "ageSquared",
  "marketValueMillions",
  "logMarketValue",
  "marketValueOver10m",
  "marketValueOver25m",
  "marketValueOver50m",
  "marketValueOver80m",
  "highestValueMillions",
  "logHighestValue",
  "previousValueMillions",
  "marketTrend",
  "internationalCaps",
  "internationalGoals",
  "totalTransferFeesMillions",
  "heightCm",
  "hasMarketValue",
  "isGK",
  "isDEF",
  "isMID",
  "isATT"
];

function byTransfermarktId(rows) {
  return new Map(rows.filter((row) => row.transfermarkt_id).map((row) => [String(row.transfermarkt_id), row]));
}

function buildExamples(registryRows, transfermarktRows, options = {}) {
  const tmById = byTransfermarktId(transfermarktRows);
  const includeOutOfScope = Boolean(options.includeOutOfScope);
  const examples = [];
  const skipped = { noSoccerWikiRating: 0, noTransfermarktRow: 0, outOfScope: 0 };

  for (const registryRow of registryRows) {
    const rating = number(registryRow.soccerwiki_rating, 0);
    if (!rating) {
      skipped.noSoccerWikiRating += 1;
      continue;
    }
    if (!includeOutOfScope && registryRow.status === "out_of_scope") {
      skipped.outOfScope += 1;
      continue;
    }
    const tmRow = tmById.get(String(registryRow.transfermarkt_id));
    if (!tmRow) {
      skipped.noTransfermarktRow += 1;
      continue;
    }

    const features = featuresFor(registryRow, tmRow);
    examples.push({
      tbgPlayerId: registryRow.tbg_player_id,
      transfermarktId: registryRow.transfermarkt_id,
      soccerwikiId: registryRow.soccerwiki_id,
      playerName: registryRow.soccerwiki_name || registryRow.canonical_name || tmRow.display_name,
      transfermarktName: tmRow.display_name,
      clubName: registryRow.current_club || tmRow.current_club,
      position: registryRow.primary_position || tmRow.position,
      positionGroup: positionGroup(registryRow.primary_position || tmRow.position),
      targetRating: rating,
      marketValueEur: number(tmRow.market_value_eur, 0),
      highestMarketValueEur: number(tmRow.highest_market_value_eur, 0),
      previousMarketValueEur: number(tmRow.previous_market_value_eur, 0),
      age: number(tmRow.age, 0),
      features
    });
  }

  return { examples, skipped };
}

function metrics(predictions) {
  const errors = predictions.map((row) => row.error);
  const abs = predictions.map((row) => row.absoluteError);
  return {
    meanError: round(mean(errors), 3),
    meanAbsoluteError: round(mean(abs), 3),
    medianAbsoluteError: round(median(abs), 3),
    maxAbsoluteError: round(Math.max(...abs), 3),
    withinOne: round(predictions.filter((row) => row.absoluteError <= 1).length / predictions.length, 3),
    withinTwo: round(predictions.filter((row) => row.absoluteError <= 2).length / predictions.length, 3),
    score: round(Math.max(0, 100 - mean(abs) * 15), 2)
  };
}

function groupMetrics(predictions, key) {
  const groups = new Map();
  for (const row of predictions) {
    const value = row[key] || "UNKNOWN";
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return Object.fromEntries([...groups.entries()].sort().map(([name, rows]) => [name, { examples: rows.length, ...metrics(rows) }]));
}

function tbgRatingBand(rating) {
  if (rating >= 94) return "world_elite";
  if (rating >= 91) return "elite";
  if (rating >= 89) return "top_tier";
  if (rating >= 87) return "first_team";
  if (rating >= 84) return "senior_squad";
  return "development";
}

function disagreementType(error) {
  if (error <= -1.25) return "smw_higher_than_tbg";
  if (error >= 1.25) return "tbg_higher_than_smw";
  if (Math.abs(error) <= 0.5) return "aligned";
  return "minor_difference";
}

function disagreementNote(row) {
  if (row.disagreementType === "smw_higher_than_tbg") {
    return "SoccerWiki/SMW rating is materially higher than the objective TBG model. Possible legacy, title, status or editorial boost.";
  }
  if (row.disagreementType === "tbg_higher_than_smw") {
    return "Objective TBG model is materially higher than SoccerWiki/SMW. Possible delayed rise, harsh drop, injury lag or undervalued player.";
  }
  if (row.disagreementType === "minor_difference") return "Small difference within normal calibration tolerance.";
  return "Model and SoccerWiki/SMW are closely aligned.";
}

function adjustment(value, reason) {
  return { value: round(value, 3), reason };
}

function tbgV2Adjustments(example, smwEquivalentRaw) {
  const age = number(example.age, 0);
  const marketValueMillions = number(example.marketValueEur, 0) / 1_000_000;
  const highestValueMillions = number(example.highestMarketValueEur, 0) / 1_000_000;
  const previousValueMillions = number(example.previousMarketValueEur, 0) / 1_000_000;
  const currentToPeak = highestValueMillions > 0 ? marketValueMillions / highestValueMillions : 1;
  const components = [];

  if (marketValueMillions >= 150) components.push(adjustment(0.35, "world-superstar market signal"));
  else if (marketValueMillions >= 100) components.push(adjustment(0.2, "elite market signal"));

  if (age <= 20 && marketValueMillions >= 35) components.push(adjustment(0.45, "teenage elite-potential premium"));
  else if (age <= 22 && marketValueMillions >= 50) components.push(adjustment(0.3, "young elite-potential premium"));
  else if (age <= 24 && marketValueMillions >= 75) components.push(adjustment(0.15, "early-prime high-ceiling premium"));

  if (previousValueMillions > 0) {
    const trend = (marketValueMillions - previousValueMillions) / previousValueMillions;
    if (trend >= 0.75 && marketValueMillions >= 25) components.push(adjustment(0.25, "strong recent market rise"));
    else if (trend <= -0.5 && previousValueMillions >= 20) components.push(adjustment(-0.25, "sharp recent market fall"));
  }

  if (age >= 32 && marketValueMillions < 10 && smwEquivalentRaw >= 88) components.push(adjustment(-0.35, "age-and-current-market decline check"));
  if (age >= 34 && marketValueMillions < 5 && smwEquivalentRaw >= 87) components.push(adjustment(-0.25, "late-career low-market safeguard"));
  if (highestValueMillions >= 40 && currentToPeak <= 0.25 && age >= 30) components.push(adjustment(-0.25, "large fall from peak market status"));

  if (example.positionGroup === "GK") components.push(adjustment(0.1, "goalkeeper longevity stability"));
  if (example.positionGroup === "ATT" && marketValueMillions < 20 && smwEquivalentRaw >= 90) components.push(adjustment(-0.2, "attacker output/value reality check"));

  const rawTotal = components.reduce((sum, item) => sum + item.value, 0);
  const cappedTotal = clamp(rawTotal, -1.25, 1.25);
  if (round(cappedTotal, 3) !== round(rawTotal, 3)) components.push(adjustment(cappedTotal - rawTotal, "compatibility cap"));
  return {
    total: round(cappedTotal, 3),
    components,
    reasons: components.map((item) => `${item.value >= 0 ? "+" : ""}${item.value}: ${item.reason}`)
  };
}

function buildDisagreementAudit(predictions) {
  const rows = [...predictions].sort((a, b) => b.absoluteError - a.absoluteError || a.playerName.localeCompare(b.playerName));
  return {
    summary: {
      aligned: rows.filter((row) => row.disagreementType === "aligned").length,
      minorDifference: rows.filter((row) => row.disagreementType === "minor_difference").length,
      smwHigherThanTbg: rows.filter((row) => row.disagreementType === "smw_higher_than_tbg").length,
      tbgHigherThanSmw: rows.filter((row) => row.disagreementType === "tbg_higher_than_smw").length
    },
    materialDisagreements: rows.filter((row) => Math.abs(row.error) >= 1.25).slice(0, 50)
  };
}

export function trainRegistrySmwRatingModel(registryRows, transfermarktRows, options = {}) {
  const featureNames = options.features ?? DEFAULT_FEATURES;
  const { examples, skipped } = buildExamples(registryRows, transfermarktRows, options);
  if (examples.length < featureNames.length + 2) {
    throw new Error(`Not enough registry-linked examples to train model: ${examples.length} examples for ${featureNames.length} features.`);
  }

  const x = examples.map((example) => featureNames.map((name) => number(example.features[name])));
  const y = examples.map((example) => example.targetRating);
  const coefficients = fitRidgeRegression(x, y, number(options.ridge ?? 10));

  const predictions = examples.map((example) => {
    const smwEquivalentRaw = clamp(predict(example.features, coefficients, featureNames), 60, 99);
    const smwEquivalentRating = Math.round(smwEquivalentRaw);
    const tbgV2 = tbgV2Adjustments(example, smwEquivalentRaw);
    const tbgRatingRaw = clamp(smwEquivalentRaw + tbgV2.total, 60, 99);
    const tbgRating = Math.round(tbgRatingRaw);
    const error = smwEquivalentRaw - example.targetRating;
    const disagreement = disagreementType(error);
    return {
      tbgPlayerId: example.tbgPlayerId,
      transfermarktId: example.transfermarktId,
      soccerwikiId: example.soccerwikiId,
      playerName: example.playerName,
      transfermarktName: example.transfermarktName,
      clubName: example.clubName,
      position: example.position,
      positionGroup: example.positionGroup,
      age: example.age,
      marketValueEur: example.marketValueEur,
      highestMarketValueEur: example.highestMarketValueEur,
      previousMarketValueEur: example.previousMarketValueEur,
      targetRating: example.targetRating,
      smwEquivalentRaw: round(smwEquivalentRaw, 2),
      smwEquivalentRating,
      predictedRating: round(smwEquivalentRaw, 2),
      tbgV2Adjustment: tbgV2.total,
      tbgV2AdjustmentComponents: tbgV2.components,
      tbgV2AdjustmentReasons: tbgV2.reasons,
      tbgRatingRaw: round(tbgRatingRaw, 2),
      tbgRating,
      tbgRatingBand: tbgRatingBand(tbgRating),
      smwDeltaRounded: smwEquivalentRating - example.targetRating,
      tbgDeltaRounded: tbgRating - example.targetRating,
      ratingDeltaRounded: tbgRating - example.targetRating,
      error: round(error, 3),
      absoluteError: round(Math.abs(error), 3),
      disagreementType: disagreement,
      disagreementNote: disagreementNote({ disagreementType: disagreement })
    };
  });

  predictions.sort((a, b) => b.targetRating - a.targetRating || a.playerName.localeCompare(b.playerName));
  const disagreementAudit = buildDisagreementAudit(predictions);

  return {
    meta: {
      version: "registry-smw-rating-model-v2.0",
      trainedAt: new Date().toISOString(),
      examples: examples.length,
      registryRows: registryRows.length,
      transfermarktRows: transfermarktRows.length,
      ridge: number(options.ridge ?? 10),
      philosophy: "SMW-equivalent benchmark model plus independent TBG Rating Model v2 adjustment layer.",
      tbgV2: {
        basis: "SMW-equivalent calibration score plus small, auditable objective adjustments.",
        adjustmentCap: 1.25,
        availableSignals: ["age", "current market value", "previous market value", "peak market value", "position group"],
        futureSignals: ["minutes", "recent form", "injury history", "league strength", "club strength", "European/international performance", "versatility"]
      },
      skipped
    },
    featureNames,
    coefficients: Object.fromEntries(featureNames.map((name, index) => [name, round(coefficients[index], 8)])),
    metrics: metrics(predictions),
    metricsByPositionGroup: groupMetrics(predictions, "positionGroup"),
    disagreementAudit,
    biggestMisses: [...predictions].sort((a, b) => b.absoluteError - a.absoluteError || a.playerName.localeCompare(b.playerName)).slice(0, 25),
    tbgRatings: predictions.map((row) => ({
      tbgPlayerId: row.tbgPlayerId,
      transfermarktId: row.transfermarktId,
      playerName: row.playerName,
      clubName: row.clubName,
      positionGroup: row.positionGroup,
      age: row.age,
      marketValueEur: row.marketValueEur,
      smwEquivalentRating: row.smwEquivalentRating,
      smwEquivalentRaw: row.smwEquivalentRaw,
      tbgV2Adjustment: row.tbgV2Adjustment,
      tbgV2AdjustmentReasons: row.tbgV2AdjustmentReasons,
      tbgRating: row.tbgRating,
      tbgRatingRaw: row.tbgRatingRaw,
      tbgRatingBand: row.tbgRatingBand,
      smwRating: row.targetRating,
      smwDeltaRounded: row.smwDeltaRounded,
      tbgDeltaRounded: row.tbgDeltaRounded,
      disagreementType: row.disagreementType
    })),
    predictions
  };
}

export function formatRegistrySmwModelReport(model) {
  const lines = [
    "# Registry-first SMW Rating Model",
    `Version: ${model.meta.version}`,
    `Philosophy: ${model.meta.philosophy}`,
    `Examples: ${model.meta.examples}`,
    `Registry rows: ${model.meta.registryRows}`,
    `Transfermarkt rows: ${model.meta.transfermarktRows}`,
    `Score: ${model.metrics.score}/100`,
    `Mean error: ${model.metrics.meanError}`,
    `Mean absolute error: ${model.metrics.meanAbsoluteError}`,
    `Median absolute error: ${model.metrics.medianAbsoluteError}`,
    `Max absolute error: ${model.metrics.maxAbsoluteError}`,
    `Within 1 rating point: ${Math.round(model.metrics.withinOne * 100)}%`,
    `Within 2 rating points: ${Math.round(model.metrics.withinTwo * 100)}%`,
    "",
    "TBG Rating Model v2:",
    `- Basis: ${model.meta.tbgV2.basis}`,
    `- Adjustment cap: ±${model.meta.tbgV2.adjustmentCap}`,
    `- Current signals: ${model.meta.tbgV2.availableSignals.join(", ")}`,
    `- Future signals: ${model.meta.tbgV2.futureSignals.join(", ")}`,
    "",
    "Skipped:",
    `- No SoccerWiki rating: ${model.meta.skipped.noSoccerWikiRating}`,
    `- No Transfermarkt row: ${model.meta.skipped.noTransfermarktRow}`,
    `- Out of scope: ${model.meta.skipped.outOfScope}`,
    "",
    "Disagreement audit:",
    `- Aligned: ${model.disagreementAudit.summary.aligned}`,
    `- Minor difference: ${model.disagreementAudit.summary.minorDifference}`,
    `- SoccerWiki higher than TBG: ${model.disagreementAudit.summary.smwHigherThanTbg}`,
    `- TBG higher than SoccerWiki: ${model.disagreementAudit.summary.tbgHigherThanSmw}`,
    "",
    "Position metrics:"
  ];

  for (const [group, stats] of Object.entries(model.metricsByPositionGroup)) {
    lines.push(`- ${group}: n=${stats.examples}, MAE=${stats.meanAbsoluteError}, median=${stats.medianAbsoluteError}, max=${stats.maxAbsoluteError}`);
  }

  lines.push("", "Coefficients:");
  for (const [name, value] of Object.entries(model.coefficients)) lines.push(`- ${name}: ${value}`);

  lines.push("", "Material disagreements:", "Player                   Club                     Pos  SMW-Eq TBG SMW ΔTBG Type");
  for (const row of model.disagreementAudit.materialDisagreements.slice(0, 25)) {
    lines.push([
      row.playerName.padEnd(24, " "),
      String(row.clubName ?? "").padEnd(24, " "),
      row.positionGroup.padEnd(3, " "),
      String(row.smwEquivalentRating).padStart(6, " "),
      String(row.tbgRating).padStart(3, " "),
      String(row.targetRating).padStart(3, " "),
      String(row.tbgDeltaRounded).padStart(5, " "),
      row.disagreementType
    ].join(" "));
  }

  lines.push("", "TBG v2 largest adjustments:", "Player                   Club                     Pos SMW-Eq Adj  TBG Reasons");
  for (const row of [...model.predictions].sort((a, b) => Math.abs(b.tbgV2Adjustment) - Math.abs(a.tbgV2Adjustment)).slice(0, 20)) {
    lines.push([
      row.playerName.padEnd(24, " "),
      String(row.clubName ?? "").padEnd(24, " "),
      row.positionGroup.padEnd(3, " "),
      String(row.smwEquivalentRating).padStart(6, " "),
      String(row.tbgV2Adjustment).padStart(5, " "),
      String(row.tbgRating).padStart(3, " "),
      row.tbgV2AdjustmentReasons.join(" | ")
    ].join(" "));
  }

  lines.push("", "Biggest SMW-equivalent calibration misses:", "Player                   Club                     Pos SMW-Eq TBG SMW Diff   MV");
  for (const row of model.biggestMisses) {
    lines.push([
      row.playerName.padEnd(24, " "),
      String(row.clubName ?? "").padEnd(24, " "),
      row.positionGroup.padEnd(3, " "),
      String(row.smwEquivalentRaw).padStart(6, " "),
      String(row.tbgRating).padStart(3, " "),
      String(row.targetRating).padStart(3, " "),
      String(row.error).padStart(6, " "),
      `${Math.round(row.marketValueEur / 1_000_000)}m`.padStart(5, " ")
    ].join(" "));
  }

  return lines.join("\n");
}

export { DEFAULT_FEATURES, featuresFor, buildExamples, tbgRatingBand, disagreementType, tbgV2Adjustments };
