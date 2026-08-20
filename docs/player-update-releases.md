# Rolling player update releases

This layer turns the governed append-only player change queue into immutable manager-facing release batches.

## Source contract

`derived/player-changes/player-change-queue.json` remains the durable source of detected events. Ordinary database rebuilds append events; the publisher is the only process that changes a selected event from `pending` to `published` and attaches publication metadata.

The publisher does not invent rating changes or new players. It only releases already-governed queue events.

## Release outputs

`derived/player-changes/player-release-history.json`
: Immutable release history. Each release snapshots the selected events, their provenance, policy, release slot and publication time.

`derived/player-changes/player-release-latest.json`
: Compact Manager-facing projection of the latest release, split into `ratings_updates`, `new_players` and optional `other_updates`.

`derived/player-changes/player-release-summary.json`
: Operational summary of the latest publish attempt, including spill-over still pending.

## Selection policy

The default manager-facing release considers only:

- `rating_change`
- `new_player`

Club changes, newly unsigned players and removals remain governed queue events but are not mixed into Ratings Updates / New Players unless `includeStateChanges=true` is explicitly requested.

Selection is deterministic:

1. oldest detection batch first, preventing later refreshes from starving older pending changes;
2. within the same detection time, larger rating movements / stronger newly published players first;
3. event ID is the final stable tie-break.

`target` is a preferred maximum for an ordinary release, not a quota. If only seven eligible events are pending, seven are published. `max` is an independent hard safety ceiling. Remaining eligible events spill into later release slots.

## Idempotency

A release slot can be published at most once. Re-running the same slot returns the existing release and does not consume additional pending events or rewrite release history.

The release ID is derived from the slot plus the selected governed event IDs. Queue event IDs remain unchanged.

## Operations

Use the manual **Publish Player Updates** workflow while the cadence is being calibrated. It runs tests first, publishes a release, uploads the release artifacts and commits changed player-release data.

No automatic paid Apify schedule is enabled by this slice. Source refresh cadence and manager-facing release cadence remain separate decisions.

## Next consumer

The Manager can consume `player-release-latest.json` to build **Ratings Updates** and **New Players** views without needing to understand queue internals or reproduce rating calculations.
