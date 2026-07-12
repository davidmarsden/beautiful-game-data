# Player Universe Coverage Audit

Generated: 2026-07-12T20:57:21.920Z

## Pipeline stages
- raw_import: 3578 rows / 3121 unique TM IDs
- players_master: 7001 rows / 7001 unique TM IDs
- player_registry: 7001 rows / 7001 unique TM IDs
- rated_global_pool: 7001 rows / 7001 unique TM IDs
- published_database: 7001 rows / 7001 unique TM IDs

## Top 80 squad completeness
- Complete: 80
- Thin: 0
- Missing: 0


## High-priority external missing players
Count: 0


## Dropout categories
- amateur_or_unvalued: 98
- below_value_threshold: 41
- reserve_team: 6
- retired: 5
- zero_value_prospect: 4
- free_agent: 1

## Unexpected dropouts
Count: 0

## Stage dropouts
- raw_import → players_master: 155
- players_master → player_registry: 0
- player_registry → rated_global_pool: 0
- rated_global_pool → published_database: 0
