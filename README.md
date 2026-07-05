# The Beautiful Game — Data

Canonical data and import pipelines for **The Beautiful Game**.

This repository stores football data separately from the engine and governance.

## Repository roles

```text
beautiful-game-governance  -> rules and constitutions
beautiful-game-engine      -> simulation code
beautiful-game-data        -> imported and derived football data
```

## Structure

```text
importers/      provider-specific import code
providers/      raw provider-shaped snapshots
derived/        Beautiful Game canonical data
scripts/        command-line import runners
```

## API-Football workflow

Add your API key as a repository secret:

1. Open this repo on GitHub.
2. Go to Settings.
3. Go to Secrets and variables, then Actions.
4. Add a repository secret called `API_FOOTBALL_KEY`.

Then run an import:

1. Go to Actions.
2. Choose `Import API-Football Data`.
3. Tap `Run workflow`.
4. Start with league `39`, season `2025`, max pages `1`.

Snapshots are committed under:

```text
providers/api-football/
```

## Transfermarkt calibration workflow

The wide Transfermarkt fetch now covers the big-five leagues plus key calibration leagues and also includes the gold-standard rescue names. This prevents the benchmark being dominated by Premier League coverage.

```bash
npm run fetch:transfermarkt:wide
npm run import:transfermarkt:wide
npm run gold-standard:coverage
npm run score:tbg-ratings
npm run gold-standard:review
```

The default wide fetch writes `calibration/apify-transfermarkt-wide-dataset.json`.

The import merges that into the Transfermarkt master files under `data/transfermarkt/` and refreshes `calibration/transfermarkt-values.csv`.

The coverage audit writes `calibration/transfermarkt-gold-standard-coverage.csv` and `calibration/transfermarkt-gold-standard-coverage-summary.json`.
