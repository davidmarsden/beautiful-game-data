# Player Universe Coverage Audit

Generated: 2026-07-12T10:42:16.824Z

## Pipeline stages
- raw_import: 3578 rows / 3121 unique TM IDs
- players_master: 7000 rows / 7000 unique TM IDs
- player_registry: 7000 rows / 7000 unique TM IDs
- rated_global_pool: 6781 rows / 6781 unique TM IDs
- published_database: 6781 rows / 6781 unique TM IDs

## Top 80 squad completeness
- Complete: 80
- Thin: 0
- Missing: 0


## High-priority external missing players
Count: 0


## Dropout categories
- amateur_or_unvalued: 299
- below_value_threshold: 41
- free_agent: 14
- zero_value_prospect: 8
- reserve_team: 7
- retired: 5

## Unexpected dropouts
Count: 0

## Stage dropouts
- raw_import → players_master: 155
- players_master → player_registry: 0
- player_registry → rated_global_pool: 219
- rated_global_pool → published_database: 0
