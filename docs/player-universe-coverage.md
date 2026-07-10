# Player Universe Coverage

## Principle

Transfermarkt remains the wider external catalogue for professional players. The Beautiful Game does not need to ingest and rate every Transfermarkt-valued professional in advance.

A player may exist in one of three states:

1. **Core rated player** — every player at a canonical Top 80 club.
2. **External rated transfer target** — an outside player meeting the committed value/age rules, or a manager-requested player.
3. **Transfermarkt-only player** — discoverable by managers on Transfermarkt and imported into TBG only when requested or promoted by policy.

The current thresholds live in `data/config/player-universe-policy.json`.

## Commands

### Build the lightweight wider registry

```bash
npm run build:wider-player-registry
```

This extracts identity, club, position and value metadata from the local Transfermarkt master without creating a full TBG rating record.

### Audit coverage

```bash
npm run audit:player-universe
```

Outputs:

- `derived/player-universe/player-universe-coverage-audit.json`
- `derived/player-universe/player-universe-coverage-audit.md`

The audit reports:

- counts at each pipeline stage;
- first-stage dropouts;
- Top 80 squad completeness;
- high-priority external players absent from the published database.

### Target a player

```bash
npm run import:transfermarkt:targeted -- --playerIds=123456
```

### Target several players

```bash
npm run import:transfermarkt:targeted -- --playerIds=123456,789012
```

### Target a club squad

```bash
npm run import:transfermarkt:targeted -- --clubIds=585
```

### Search by exact player name when an ID is not known

```bash
npm run import:transfermarkt:targeted -- --searchQueries="Kees Smit"
```

Player and club IDs are preferred because names may be ambiguous.

### Reuse an existing Apify dataset

```bash
npm run import:transfermarkt:targeted -- --datasetId=EXISTING_DATASET_ID
```

This avoids a new scrape and therefore avoids unnecessary Apify usage.

### Rebuild the published database

```bash
npm run rebuild:published-player-database
```

This re-scores ratings, exports TBG pools, exports the player database, rebuilds the lightweight registry, reruns coverage checks and rebuilds the Pink Final site.

## GitHub Actions

Run **Player Universe Coverage** with one of three modes:

- `audit` — no Apify scrape; inspect existing coverage only;
- `targeted-import` — import named player IDs, club IDs, search queries, or reuse a dataset;
- `rebuild` — regenerate rated pools, the published player database, audit outputs and the site from existing local data.

## Manager requests

Managers should continue using Transfermarkt as the wider search catalogue. A request to add a player should include the Transfermarkt player URL or numeric player ID. Approved requests use the targeted import path; no full-world scrape is required.
