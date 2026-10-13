# SM ↔ Transfermarkt ↔ TBG Identity Registry — feasibility implementation

## Purpose
Link the complete 96,693-player Soccer Manager universe (source snapshot 2026-10-12) to the existing Transfermarkt-backed TBG registry without replacing permanent TBG identities or simulation history. The SM source is maintained by `top100-manager-lab`; the TM registry and matching logic live here. No raw private SM dataset is committed to Git.

## Initial implementation
`src/identity/reconcileSmTm.js` generates reproducible, explainable candidate proposals. Inputs are arrays of SM and TM/registry rows. SM IDs accept `playerDataId`/`player_data_id`; TM IDs accept `transfermarkt_id`. Full ISO date of birth, name, real-world club, nationality and position contribute to scoring. Exact contradictory DOBs disqualify candidates. Candidates are blocked by DOB or normalized name to avoid a quadratic comparison. Strong unambiguous candidates are **proposals**, not writes. Multiple source players claiming one TM identity are forced to review. Human-reviewed decisions can be supplied separately.

## Non-negotiable safeguards
- Never use the SM world-specific `playerId` as the stable SM identity.
- Do not overwrite `tbg_player_id`, gameplay clubs, contracts, history, ratings or match records.
- Never silently merge conflicting or duplicate identities.
- Persist positive and negative human adjudications with reviewer, time, snapshot and algorithm version before production use.
- Real-world club evidence is time-sensitive; compare snapshot dates and historical affiliations in a later phase.
- Candidate scores are **heuristics, not calibrated probabilities**; benchmark precision and recall before allowing automatic publication.
- Existing `playerIdentityResolver.js` is not replaced: this is a separate cross-provider reconciliation pipeline.

## Next integration steps
1. Inspect the actual 96,693-record SM snapshot schema and current TM master/registry field coverage; adapt input mappings based on evidence.
2. Run an offline, read-only sample through `reconcilePlayerIdentities`; export top candidates and reasons for adjudication.
3. Assemble a gold standard with exact matches, common names, transliterations, transfers, youth, missing DOBs and known non-matches.
4. Measure precision, recall, collision rate and coverage by player cohort; recalibrate scoring and thresholds.
5. Add a durable append-only decisions registry and reviewed export contract for the TBG 2 importer. The launch import must preserve SM-derived identities and later attach TM IDs without changing TBG IDs.
6. Resolve the external-player-market issue in `beautiful-game-manager` PR #460 using the verified global snapshot and this registry contract.

## Current scope limitation
This PR provides a tested candidate-generation kernel and architecture contract. It does **not** claim 96,693 successful cross-source matches, run on private Supabase data, or implement a production adjudication UI.
