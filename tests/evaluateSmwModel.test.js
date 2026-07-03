import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSmwRatingModel, formatSmwRatingEvaluationReport } from "../src/ratingModel/evaluateSmwModel.js";

const model = {
  meta: { version: "test-model", targetRows: 4, ridge: 1, calibrated: true },
  predictions: [
    { playerName: "Keeper", clubName: "Alpha", positionGroup: "GK", targetRating: 90, rawPrediction: 89, predictedRating: 89.5, error: -0.5, absoluteError: 0.5, matchReason: "exact-name", clubMismatch: false },
    { playerName: "Centre Back", clubName: "Alpha", positionGroup: "DEF", targetRating: 88, rawPrediction: 89.5, predictedRating: 90, error: 2, absoluteError: 2, matchReason: "initial-surname", clubMismatch: false },
    { playerName: "Midfielder", clubName: "Beta", positionGroup: "MID", targetRating: 84, rawPrediction: 82.5, predictedRating: 83, error: -1, absoluteError: 1, matchReason: "exact-name", clubMismatch: true },
    { playerName: "Forward", clubName: "Beta", positionGroup: "ATT", targetRating: 92, rawPrediction: 93, predictedRating: 95, error: 3, absoluteError: 3, matchReason: "club-tiebreak", clubMismatch: false }
  ]
};

test("evaluates SMW rating model predictions", () => {
  const evaluation = evaluateSmwRatingModel(model);

  assert.equal(evaluation.overall.count, 4);
  assert.equal(evaluation.overall.mae, 1.625);
  assert.equal(evaluation.rawOverall.mae, 1.375);
  assert.equal(evaluation.byPosition.GK.mae, 0.5);
  assert.equal(evaluation.byRatingBand["90-94"].count, 2);
  assert.equal(evaluation.clubMismatch.count, 1);
  assert.equal(evaluation.overRated[0].playerName, "Forward");
  assert.equal(evaluation.underRated[0].playerName, "Midfielder");
});

test("formats SMW rating evaluation report", () => {
  const text = formatSmwRatingEvaluationReport(evaluateSmwRatingModel(model));

  assert.match(text, /# SMW Rating Calibration/);
  assert.match(text, /Players evaluated: 4/);
  assert.match(text, /Calibrated MAE: 1.625/);
  assert.match(text, /Raw vs calibrated by position/);
  assert.match(text, /By position/);
  assert.match(text, /Biggest under-ratings/);
});
