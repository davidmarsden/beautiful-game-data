function round(value, digits = 3) {
  return Number(Number(value ?? 0).toFixed(digits));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function predictionKey(row) {
  return row.playerId ?? `${row.playerName}|${row.clubName}`;
}

function summariseDeltas(rows) {
  const baselineErrors = rows.map((row) => Math.abs(Number(row.baselineError ?? 0)));
  const marketErrors = rows.map((row) => Math.abs(Number(row.marketError ?? 0)));
  const improvements = rows.map((row) => Number(row.improvement ?? 0));
  return {
    count: rows.length,
    baselineMae: round(mean(baselineErrors)),
    marketMae: round(mean(marketErrors)),
    maeChange: round(mean(marketErrors) - mean(baselineErrors)),
    averageImprovement: round(mean(improvements)),
    improved: rows.filter((row) => row.improvement > 0).length,
    worsened: rows.filter((row) => row.improvement < 0).length,
    unchanged: rows.filter((row) => row.improvement === 0).length
  };
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, groupRows]) => [key, summariseDeltas(groupRows)]));
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

function modelPredictionsByKey(model) {
  return new Map((model.predictions ?? []).map((row) => [predictionKey(row), row]));
}

export function compareSmwRatingModels(baselineModel, marketModel, options = {}) {
  const baseline = modelPredictionsByKey(baselineModel);
  const deltas = [];

  for (const marketRow of marketModel.predictions ?? []) {
    const baseRow = baseline.get(predictionKey(marketRow));
    if (!baseRow) continue;
    const baselineAbs = Math.abs(Number(baseRow.error ?? 0));
    const marketAbs = Math.abs(Number(marketRow.error ?? 0));
    deltas.push({
      playerId: marketRow.playerId,
      playerName: marketRow.playerName,
      clubName: marketRow.clubName,
      positionGroup: marketRow.positionGroup,
      targetRating: marketRow.targetRating,
      baselinePrediction: baseRow.predictedRating,
      marketPrediction: marketRow.predictedRating,
      predictionShift: round(Number(marketRow.predictedRating ?? 0) - Number(baseRow.predictedRating ?? 0)),
      baselineError: baseRow.error,
      marketError: marketRow.error,
      improvement: round(baselineAbs - marketAbs),
      marketValueEur: marketRow.marketValueEur ?? 0,
      marketValueMatched: Boolean(marketRow.marketValueMatched),
      matchReason: marketRow.matchReason,
      clubMismatch: Boolean(marketRow.clubMismatch)
    });
  }

  const biggestImprovers = [...deltas].sort((a, b) => b.improvement - a.improvement || Math.abs(b.predictionShift) - Math.abs(a.predictionShift)).slice(0, Number(options.limit ?? 20));
  const biggestWorseners = [...deltas].sort((a, b) => a.improvement - b.improvement || Math.abs(b.predictionShift) - Math.abs(a.predictionShift)).slice(0, Number(options.limit ?? 20));
  const biggestMovers = [...deltas].sort((a, b) => Math.abs(b.predictionShift) - Math.abs(a.predictionShift)).slice(0, Number(options.limit ?? 20));

  return {
    meta: {
      version: "smw-market-impact-v1.0",
      comparedAt: new Date().toISOString(),
      playersCompared: deltas.length,
      marketValueRows: marketModel.meta?.marketValueRows ?? 0,
      marketValueMatches: marketModel.meta?.marketValueMatches ?? 0,
      marketValueCoverage: marketModel.meta?.marketValueCoverage ?? 0
    },
    overall: summariseDeltas(deltas),
    matchedMarketValues: summariseDeltas(deltas.filter((row) => row.marketValueMatched)),
    unmatchedMarketValues: summariseDeltas(deltas.filter((row) => !row.marketValueMatched)),
    byPosition: groupBy(deltas, (row) => row.positionGroup ?? "UNK"),
    byRatingBand: groupBy(deltas, (row) => ratingBand(row.targetRating)),
    biggestImprovers,
    biggestWorseners,
    biggestMovers,
    deltas
  };
}

function money(value) {
  const eur = Number(value ?? 0);
  if (!eur) return "-";
  if (eur >= 1_000_000) return `€${round(eur / 1_000_000, 1)}m`;
  if (eur >= 1_000) return `€${round(eur / 1_000, 1)}k`;
  return `€${eur}`;
}

function signed(value) {
  const numeric = Number(value ?? 0);
  return numeric > 0 ? `+${round(numeric)}` : String(round(numeric));
}

function formatSummaryRow(name, summary) {
  return [
    String(name).padEnd(18, " "),
    String(summary.count).padStart(5, " "),
    String(summary.baselineMae).padStart(8, " "),
    String(summary.marketMae).padStart(8, " "),
    signed(summary.maeChange).padStart(8, " "),
    String(summary.improved).padStart(8, " "),
    String(summary.worsened).padStart(8, " ")
  ].join(" ");
}

function formatDelta(row) {
  return [
    String(row.playerName ?? "").padEnd(24, " "),
    String(row.clubName ?? "").padEnd(24, " "),
    String(row.positionGroup ?? "").padEnd(3, " "),
    String(row.targetRating ?? "").padStart(3, " "),
    String(row.baselinePrediction ?? "").padStart(5, " "),
    String(row.marketPrediction ?? "").padStart(5, " "),
    signed(row.predictionShift).padStart(6, " "),
    signed(row.improvement).padStart(6, " "),
    money(row.marketValueEur).padStart(9, " ")
  ].join(" ");
}

export function formatSmwMarketImpactReport(report) {
  const lines = [
    "# SMW Market Value Impact",
    `Players compared: ${report.meta.playersCompared}`,
    `Market value coverage: ${report.meta.marketValueMatches}/${report.meta.playersCompared} (${Math.round(Number(report.meta.marketValueCoverage ?? 0) * 100)}%)`,
    `Baseline MAE: ${report.overall.baselineMae}`,
    `Market MAE: ${report.overall.marketMae}`,
    `MAE change: ${signed(report.overall.maeChange)}`,
    `Improved / worsened: ${report.overall.improved}/${report.overall.worsened}`,
    "",
    "## Coverage split",
    "Group              Count  BaseMAE MarketMAE   Change Improved Worsened",
    formatSummaryRow("matched", report.matchedMarketValues),
    formatSummaryRow("unmatched", report.unmatchedMarketValues),
    "",
    "## By position",
    "Group              Count  BaseMAE MarketMAE   Change Improved Worsened"
  ];

  for (const [group, summary] of Object.entries(report.byPosition)) lines.push(formatSummaryRow(group, summary));

  lines.push("", "## By SMW rating band", "Band               Count  BaseMAE MarketMAE   Change Improved Worsened");
  for (const [band, summary] of Object.entries(report.byRatingBand)) lines.push(formatSummaryRow(band, summary));

  lines.push("", "## Biggest improvers", "Player                   Club                     Pos SMW  Base Market  Shift   Gain     Value");
  for (const row of report.biggestImprovers.slice(0, 15)) lines.push(formatDelta(row));

  lines.push("", "## Biggest worseners", "Player                   Club                     Pos SMW  Base Market  Shift   Gain     Value");
  for (const row of report.biggestWorseners.slice(0, 15)) lines.push(formatDelta(row));

  lines.push("", "## Biggest prediction movers", "Player                   Club                     Pos SMW  Base Market  Shift   Gain     Value");
  for (const row of report.biggestMovers.slice(0, 15)) lines.push(formatDelta(row));

  return lines.join("\n");
}
