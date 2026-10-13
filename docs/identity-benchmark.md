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

This writes `gold-evaluation.private.json`: strict, wide and combined discovery recall per stratum, and per-rule precision. A rule is scored against its own target. A pair rejection of that target counts as a false positive, and rows that cannot be decided are counted rather than dropped. TM-anchored rows with an unknown `truth_status`, `found` without an SM id, or any other status that still carries an SM id are listed as invalid and never scored. Adjudications are run through `validateIdentityDecisions`, so contradictory decisions are reported instead of scored.

Thresholds are not tuned until the gold samples are adjudicated.

## First run (13 Oct 2026)

Snapshot `universe-2026-10-12T20:10:39.722Z`, with 96,693 SM rows against 9,226 TM rows, code `1c00f25`, Manager Lab run 38465300099. The figures below are aggregate counts only.

- **Age is reliable.** On 6,871 unverified one-to-one probes, SM age equals TM age on the snapshot date for 98.3% and is within one year for 99.8%.
- **Discovery (proxy):** 97.7% of TM players appear among some SM row's strict candidates, and 99.2% with the wide search added. Gaps are largest for TM nicknames (strict 94.0%; age-consistent 86.4%) and Brazil/Portugal (age-consistent 92.6%). These are upper bounds, because a TM player counts as found if any SM row lists it.
- **Automatic linking:** 33 proposals, all from the 50-player DOB control group. A hypothetical age-based rule (`h_age1`) would fire for 9,091 SM rows across 8,734 TM players, and 274 of those TM players would be claimed by more than one SM row. Its precision is unknown until the SM-anchored sample is adjudicated.
- **Top candidates by SM name variant:** forename + surname 9,117; initial + surname 3,697; surname only 1,174. Initial + surname is expected to be the noisiest.
- **SM players rated 85+:** 3,128, of whom 539 have no strict candidate. They are sampled as likely discovery misses.
- **Countries:** every SM country without a TM label is a nation absent from the TM master (51, e.g. Kyrgyzstan, Qatar); no labelling gaps remain.
