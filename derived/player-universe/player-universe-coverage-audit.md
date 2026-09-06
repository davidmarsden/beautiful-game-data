# Player Universe Coverage Audit

Generated: 2026-09-06T09:25:08.546Z

## Pipeline stages
- raw_import: 3578 rows / 3121 unique TM IDs
- players_master: 9226 rows / 9226 unique TM IDs
- player_registry: 9226 rows / 9226 unique TM IDs
- rated_global_pool: 9217 rows / 9217 unique TM IDs
- published_database: 9217 rows / 9217 unique TM IDs

## Top 80 squad completeness
- Complete: 80
- Thin: 0
- Missing: 0


## High-priority external missing players
Count: 0


## Dropout categories
- amateur_or_unvalued: 96
- retired: 10
- below_value_threshold: 5
- reserve_team: 4
- free_agent: 1
- zero_value_prospect: 1

## Unexpected dropouts
Count: 0

## Stage dropouts
- raw_import → players_master: 108
- players_master → player_registry: 0
- player_registry → rated_global_pool: 9
- rated_global_pool → published_database: 0
