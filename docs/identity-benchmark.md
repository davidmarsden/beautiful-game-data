# SM ↔ TM identity benchmark

A repeatable, read-only benchmark of the SM ↔ Transfermarkt reconciler against real snapshots. It links nothing and writes nothing to any database.

## What it measures

The benchmark keeps two questions apart:

| Question | Measured by | Needs truth? |
| --- | --- | --- |
| **Discovery recall**: is the right TM player anywhere in the candidates? | TM-side discovery: for each TM player, did some SM row find it? Reported for the strict reconciler and for a wider diagnostic search (any surname token, age within one year), by stratum | Proxy now; exact once the TM-anchored gold sample is adjudicated |
| **Automatic-linking precision**: when a rule would link, is it right? | Top-candidate correctness for each rule on the SM-anchored gold sample | Yes: adjudicated sample |

Strata cover the hard cases: Brazilian and Portuguese players, TM nicknames, non-Latin full names, under-21s and veterans. A stratified SM sample covers unique, ambiguous, surname-only and initial-only matches, and highly rated SM players with no candidate.

## Findings that shape the design

- **SM has no date of birth.** It has an integer `Age`, which is exact on the snapshot date (verified against all 50 profile-captured DOBs). The reconciler's automatic path needs an exact DOB, so it currently proposes nothing for SM. Any age-based rule must be calibrated on the gold sample first; the benchmark reports one hypothetical rule (`h_age1`) without implementing it.
- **SM `ClubName` is the Top 100 game-world club.** Club evidence is excluded on both sides.
- **SM football names often sit in the surname field** ("Ferreira VITINHA", "Becker ALISSON"), so the surname alone is an SM name variant.
- **The TM master is about a tenth of SM's size** (9,226 vs 96,693), so most SM players cannot have a TM identity yet. SM-side candidate rates are not recall.
- **Country labels differ** ("Turkey"/"Türkiye", "Korea Republic"/"Korea, South"). The SM adapter maps known spellings, and the summary lists any that are left.

## Running it

The SM data stays in Manager Lab. Its `identity-benchmark` workflow exports minimal rows: names, age, nationality, position, rating band and verified DOBs, with no game-world data. It then runs this repository's code at a pinned commit and uploads every output as a private artifact.

Locally, with an export file:

```bash
node scripts/identity-benchmark.js run --sm sm-benchmark-rows.json \
  --tm data/transfermarkt/players-master.json --out .private/identity-benchmark/<snapshot>
```

Outputs:

| File | Contents | Privacy |
| --- | --- | --- |
| `summary.json`, `summary.md` | Counts and rates, input SHA-256s, code commit, seed | Aggregate only |
| `candidates.private.jsonl` | Per SM player: strict candidates (score, evidence, name variant, age delta) and wide candidates | Private |
| `gold-tm-anchored.private.csv` | Stratified TM players for reviewers to find in SM (assist candidates included) | Private |
| `gold-sm-anchored.private.csv` | Stratified SM players with candidates, in decision-registry shape | Private |

The same inputs and seed always give the same output. Change `--seed` to draw a fresh sample.

## Adjudicating and scoring the gold samples

- **TM-anchored rows:** set `truth_status` to `found`, `not_in_sm` or `unsure`, and `truth_sm_player_data_id` when found.
- **SM-anchored rows:** set `status` (`confirmed`, `rejected` or `unresolved`) and `transfermarkt_id`, as in the decisions registry.

Then run:

```bash
node scripts/identity-benchmark.js evaluate --dir <out-dir>
```

This reports strict, wide and combined discovery recall per stratum, and per-rule precision. Adjudications are run through `validateIdentityDecisions`, so contradictory decisions are reported instead of scored.

Thresholds are not tuned until the gold samples are adjudicated.
