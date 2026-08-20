# Governed player change queue

This is the first durable contract for the TBG Player Universe & Ratings Lifecycle.

The existing pipeline already separates three useful stages:

1. Transfermarkt/Apify refreshes update `data/transfermarkt/players-master.json`.
2. The deterministic TBG rating/publication pipeline rebuilds `derived/player-database/player-database.json`.
3. `generate-player-change-ledger.js` compares the previous and current published editions.

The governed queue adds a fourth stage without changing those responsibilities.

## Outputs

`derived/player-changes/player-change-queue.json`
: Append-only durable queue. Ordinary rebuilds may append new events but must not alter or delete existing events. New events begin with `status: pending`.

`derived/player-changes/player-change-batch.json`
: The events detected and appended by the latest rebuild only. This is the natural input for a future rolling release scheduler.

`derived/player-changes/player-change-queue-summary.json`
: Compact queue counts by status and event type.

The existing `player-change-ledger.json` / `.md` remain the human-readable latest-edition diagnostic diff.

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

## Next slice

A later release scheduler will consume pending events into immutable manager-facing release batches (for example **Ratings Updates — Today** and **New Players**) without changing the source event IDs. Publication status/release metadata should be managed explicitly by that publisher rather than by ordinary database rebuilds.
