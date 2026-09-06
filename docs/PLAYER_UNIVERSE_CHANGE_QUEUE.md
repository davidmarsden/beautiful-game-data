# Governed player change queue

This is the durable contract for the TBG Player Universe & Ratings Lifecycle.

The pipeline separates five responsibilities:

1. Transfermarkt/Apify refreshes update `data/transfermarkt/players-master.json`.
2. The deterministic TBG rating/publication pipeline rebuilds `derived/player-database/player-database.json`.
3. `generate-player-change-ledger.js` compares the previous and current published editions and writes the raw human-readable edition diff.
4. `generate-player-change-queue.js` selects governed event types, creates deterministic event identities/provenance, de-duplicates them and appends new queue entries.
5. The rolling publisher consumes eligible pending queue events into immutable manager-facing release batches.

Those responsibilities stay separate even as the source-refresh cadence becomes more frequent.

## Outputs

`derived/player-changes/player-change-queue.json`
: Append-only durable queue. Ordinary rebuilds may append new events but must not alter or delete existing events. New events begin with `status: pending`.

`derived/player-changes/player-change-batch.json`
: The governed events detected and appended by the latest queue-generation pass only.

`derived/player-changes/player-change-queue-summary.json`
: Compact queue counts by status and event type.

The existing `player-change-ledger.json` / `.md` remain the human-readable latest-edition diagnostic diff.

The rolling release layer additionally writes immutable release history and a latest-release projection.

## Event identity and idempotency

Every queued event gets a deterministic SHA-256-derived `event_id` over its football identity and provenance:

- event type;
- TBG player ID;
- Transfermarkt ID;
- before/after change payload;
- Transfermarkt source scrape timestamp;
- TBG rating-model version.

Detection time and queue position are deliberately excluded from identity. Re-running the same source edition therefore does not append the event twice.

## Provenance

Where available each event records:

- Transfermarkt source and scrape timestamp;
- Transfermarkt market-value determination date;
- TBG rating-model version;
- deterministic rating input explanation from `calibration/tbg-rating-profiles.json`;
- player-database edition generation timestamp.

A missing optional provenance field is represented honestly as `null`; the queue does not invent source dates or inputs.

## Baseline behaviour

The first published database edition establishes a baseline and does not queue every existing player as `new_player`. Only differences between established editions enter the queue.

## Current operating cadence

As of 6 September 2026, automated source refreshes are intended to keep the player world visibly alive while remaining cost-aware:

- weekdays: 300 priority known players plus 10 rotating playable clubs;
- Sunday: full playable-club reconciliation;
- monthly: wider-competition reconciliation;
- manual full refresh remains available when required.

The weekday mixed refresh is specifically designed so an ordinary day can produce both governed `rating_change` and `new_player` events.

A refresh may legitimately produce no events. The queue must reflect football evidence, not a content quota.

Operational acceptance, discovery coverage, retry behaviour and Apify cost are tracked in `beautiful-game-data#43`.

## Reliability boundary

The intended reliability boundary is that a failed or materially incomplete upstream refresh should leave the last successfully published edition in place rather than produce a hybrid edition.

That boundary is **not yet fully enforced for partial-success scrapes**. The weekday known-player workflow reports `missing_from_refresh`, but currently does not fail the run on missing returns; the Sunday and monthly reconciliation workflows also do not yet have a completeness gate. Until that is hardened, a partial Apify response can still produce a mixed refreshed/stale source snapshot.

Treat this as an open operational acceptance item under `beautiful-game-data#43`: add completeness criteria and a fail-before-publish/rollback boundary appropriate to each refresh mode, then prove it in production.

Temporary market-value bridging used during import must be fully reconciled before companion artifacts are committed, so JSON, CSV and summary outputs remain consistent.

## Manager-facing outcome

Pending eligible events are consumed into immutable release batches such as **Ratings Updates** and **New Players** without changing their source event IDs.

The intended alpha outcome is regular recent player-world activity for managers, with every visible change remaining deterministic, attributable and reproducible.