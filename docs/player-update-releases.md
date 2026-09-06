# Rolling player update releases

This layer turns the governed append-only player change queue into immutable manager-facing release batches.

## Source contract

`derived/player-changes/player-change-queue.json` remains the durable source of governed pending events. `generate-player-change-queue.js` is responsible for creating/de-duplicating queue entries; the publisher is the process that changes selected events from `pending` to `published` and attaches publication metadata.

The publisher does not invent rating changes or new players. It only releases already-governed queue events.

## Release outputs

`derived/player-changes/player-release-history.json`
: Immutable release history. Each release snapshots the selected events, their provenance, policy, release slot and publication time.

`derived/player-changes/player-release-latest.json`
: Compact latest-release projection split into `ratings_updates`, `new_players` and optional `other_updates`. This artifact exists in the data repository but is not currently the deployed Manager consumer contract.

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

## Current automated source-refresh cadence

As of 6 September 2026, the Transfermarkt/Apify source-refresh layer is automated on a cost-aware cadence:

- Monday–Friday: a mixed refresh of 300 priority known players plus a rotating slice of 10 playable clubs for new-player discovery;
- Sunday: a full reconciliation of all playable clubs;
- monthly: a wider-competition reconciliation beyond the playable-club universe;
- manual full refresh remains available when justified.

The weekday job deliberately combines two product goals: existing-player evidence can generate governed Ratings Updates, while the rotating club slice can discover genuinely new players for New Players.

New scrape results never publish directly. They pass the existing discovery policy, are merged into the Transfermarkt master, and then the deterministic TBG rebuild/queue/release pipeline decides which manager-facing events exist.

The current operational acceptance and cost-calibration work is tracked in GitHub issue `beautiful-game-data#43`.

## Release operations

Source-refresh cadence and manager-facing release cadence remain separate responsibilities. A successful source refresh may produce no eligible manager-facing events, and that is an honest outcome rather than a reason to fabricate churn.

The **Publish Player Updates** workflow remains available for explicit release control while cadence behaviour is being observed in alpha. Re-running the same release slot is idempotent.

The intended reliability rule is to retain the last successfully published edition when an upstream refresh fails or is materially incomplete. Partial-success completeness checks are not yet fully enforced across every refresh mode; that hardening remains an open item under `beautiful-game-data#43`.

## Manager consumer

The deployed Manager-facing Player Updates view currently consumes `derived/player-changes/player-release-history.json` (copied into the scouting-site build) and derives the visible **Ratings Updates** and **New Players** presentation from release history.

`player-release-latest.json` is therefore a convenience/data-layer projection at present, not the canonical deployed Manager integration contract. If the Manager is later switched to consume it directly, the scouting-site build must explicitly publish/copy that artifact as part of the same change.

The intended alpha experience is that managers usually see recent player-world activity on ordinary weekdays, while every visible change remains governed, reproducible and explainable.