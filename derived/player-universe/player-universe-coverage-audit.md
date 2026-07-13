# Player Universe Coverage Audit

Generated: 2026-07-13T21:21:59.525Z

## Pipeline stages
- raw_import: 3578 rows / 3121 unique TM IDs
- players_master: 8091 rows / 8091 unique TM IDs
- player_registry: 8091 rows / 8091 unique TM IDs
- rated_global_pool: 8090 rows / 8090 unique TM IDs
- published_database: 8090 rows / 8090 unique TM IDs

## Top 80 squad completeness
- Complete: 80
- Thin: 0
- Missing: 0


## High-priority external missing players
Count: 0


## Dropout categories
- amateur_or_unvalued: 96
- below_value_threshold: 9
- reserve_team: 4
- retired: 2
- free_agent: 1
- zero_value_prospect: 1

## Unexpected dropouts
Count: 0

## Stage dropouts
- raw_import → players_master: 112
- players_master → player_registry: 0
- player_registry → rated_global_pool: 1
- rated_global_pool → published_database: 0
