function round(value, digits = 3) {
  return Number(Number(value ?? 0).toFixed(digits));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function ratingBand(value) {
  const rating = Number(value ?? 0);
  if (rating >= 95) return "95+";
  if (rating >= 90) return "90-94";
  if (rating >= 85) return "85-89";
  if (rating >= 80) return "80-84";
  if (rating >= 75) return "75-79";
  return "<75";
}

function summariseRows(rows) {
  const errors = rows.map((row) => Number(row.error ?? 0));
  const absoluteErrors = rows.map((row) => Number(row.absoluteError ?? Math.abs(row.error ?? 0)));
  const withinHalf = absoluteErrors.filter((value) => value <= 0.5).length;
  const withinOne = absoluteErrors.filter((value) => value <= 1).length;
  const withinTwo = absoluteErrors.filter((value) => value <= 2).length;

  return {
    count: rows.length,
    meanError: round(mean(errors)),
    mae: round(mean(absoluteErrors)),
    medianAbsoluteError: round(median(absoluteErrors)),
    maxAbsoluteError: round(Math.max(0, ...absoluteErrors)),
    withinHalf: rows.length ? round(withinHalf / rows.length, 3) : 0,
    withinOne: rows.length ? round(withinOne / rows.length, 3) : 0,
    withinTwo: rows.length ? round(withinTwo / rows.length, 3) : 0
  };
}

function summariseGroups(rows, keyFn) {
  return Object.fromEntries(
    [...groupBy(rows, keyFn).entries()]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([key, groupRows]) => [key, summariseRows(groupRows)])
  );
}

export function evaluateSmwRatingModel(model, options = {}) {
  const predictions = model.predictions ?? [];
  const biggestMissLimit = Number(options.biggestMissLimit ?? 25);
  const overRated = [...predictions]
    .filter((row) => Number(row.error ?? 0) > 0)
    .sort((a, b) => Number(b.error ?? 0) - Number(a.error ?? 0))
    .slice(0, biggestMissLimit);
  const underRated = [...predictions]
    .filter((row) => Number(row.error ?? 0) < 0)
    .sort((a, b) => Number(a.error ?? 0) - Number(b.error ?? 0))
    .slice(0, biggestMissLimit);

  return {
    meta: {
      version: "smw-rating-evaluation-v1.0",
      evaluatedAt: new Date().toISOString(),
      modelVersion: model.meta?.version ?? null,
      examples: predictions.length,
      targetRows: model.meta?.targetRows ?? null,
      ridge: model.meta?.ridge ?? null
    },
    overall: summariseRows(predictions),
    byPosition: summariseGroups(predictions, (row) => row.positionGroup ?? "UNK"),
    byRatingBand: summariseGroups(predictions, (row) => ratingBand(row.targetRating)),
    byMatchReason: summariseGroups(predictions, (row) => row.matchReason ?? "unknown"),
    clubMismatch: summariseRows(predictions.filter((row) => row.clubMismatch)),
    sameClub: summariseRows(predictions.filter((row) => !row.clubMismatch)),
    overRated,
    underRated
  };
}

function percent(value) {
  return `${Math.round(Number(value ?? 0) * 100)}%`;
}

function formatSummaryRow(name, summary) {
  return [
    String(name).padEnd(18, " "),
    String(summary.count).padStart(5, " "),
    String(summary.mae).padStart(7, " "),
    String(summary.meanError).padStart(8, " "),
    String(summary.medianAbsoluteError).padStart(7, " "),
    String(summary.maxAbsoluteError).padStart(7, " "),
    percent(summary.withinOne).padStart(8, " ")
  ].join(" ");
}

function formatMiss(row) {
  return [
    String(row.playerName ?? "").padEnd(24, " "),
    String(row.clubName ?? "").padEnd(24, " "),
    String(row.positionGroup ?? "").padEnd(3, " "),
    String(row.predictedRating ?? "").padStart(5, " "),
    String(row.targetRating ?? "").padStart(3, " "),
    String(row.error ?? "").padStart(7, " "),
    String(row.matchReason ?? "")
  ].join(" ");
}

export function formatSmwRatingEvaluationReport(evaluation) {
  const lines = [
    "# SMW Rating Calibration",
    `Players evaluated: ${evaluation.overall.count}`,
    `Overall MAE: ${evaluation.overall.mae}`,
    `Median absolute error: ${evaluation.overall.medianAbsoluteError}`,
    `Max absolute error: ${evaluation.overall.maxAbsoluteError}`,
    `Within 1 rating point: ${percent(evaluation.overall.withinOne)}`,
    `Within 2 rating points: ${percent(evaluation.overall.withinTwo)}`,
    "",
    "## By position",
    "Group              Count     MAE  MeanErr     Med     Max  Within1"
  ];

  for (const [group, summary] of Object.entries(evaluation.byPosition)) lines.push(formatSummaryRow(group, summary));

  lines.push("", "## By SMW rating band", "Band               Count     MAE  MeanErr     Med     Max  Within1");
  for (const [band, summary] of Object.entries(evaluation.byRatingBand)) lines.push(formatSummaryRow(band, summary));

  lines.push("", "## By match reason", "Reason             Count     MAE  MeanErr     Med     Max  Within1");
  for (const [reason, summary] of Object.entries(evaluation.byMatchReason)) lines.push(formatSummaryRow(reason, summary));

  lines.push("", "## Biggest over-ratings", "Player                   Club                     Pos  Pred SMW    Diff Reason");
  for (const row of evaluation.overRated.slice(0, 15)) lines.push(formatMiss(row));

  lines.push("", "## Biggest under-ratings", "Player                   Club                     Pos  Pred SMW    Diff Reason");
  for (const row of evaluation.underRated.slice(0, 15)) lines.push(formatMiss(row));

  return lines.join("\n");
}
