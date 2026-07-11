# Player Universe Coverage Audit

Generated: 2026-07-11T18:17:30.953Z

## Pipeline stages
- raw_import: 3578 rows / 3121 unique TM IDs
- players_master: 6671 rows / 6671 unique TM IDs
- player_registry: 6671 rows / 6671 unique TM IDs
- rated_global_pool: 6450 rows / 6450 unique TM IDs
- published_database: 6450 rows / 6450 unique TM IDs

## Top 80 squad completeness
- Complete: 80
- Thin: 0
- Missing: 0


## High-priority external missing players
Count: 0


## Stage dropouts
- raw_import → players_master: 155
- players_master → player_registry: 0
- player_registry → rated_global_pool: 221
- rated_global_pool → published_database: 0
