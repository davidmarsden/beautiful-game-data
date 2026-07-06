# TBG Shared Repository Contracts

These schemas define the stable boundary between:

- `beautiful-game-data`
- `beautiful-game-engine`
- `beautiful-game-governance`

The data repository owns real-world source ingestion, player identities, ratings and player pools. The engine repository owns fixtures, match simulation, current-state modifiers and closed-world stress tests. Governance owns rules.

## Contract version

Initial contract version: `tbg-contract-v0.1`

## Schemas

| Schema | Purpose |
| --- | --- |
| `player.schema.json` | Canonical TBG player object. Includes sticky ability and neutral current state. |
| `rating-profile.schema.json` | Ability/current-state/effective-match rating profile. |
| `club.schema.json` | Club object with manager, budget, squad and tactics surface. |
| `competition.schema.json` | League/cup/playoff competition definition. |
| `fixture.schema.json` | Fixture input/output object. |
| `transfer.schema.json` | Transfer, release, retirement and manager-submission event. |
| `season.schema.json` | Season container. |
| `world-state.schema.json` | Full engine-loadable world snapshot. |
| `stress-test.schema.json` | Diagnostics emitted by engine stress tests. |

## Core rating principle

> Ability is sticky. Form is fluid.

The data repo supplies:

- `underlying_ability_rating`
- neutral `current_state`
- neutral `effective_match_rating`
- `ability_profile` explanation

The engine should replace fluid current-state values before each fixture:

- form
- fitness
- match sharpness
- morale
- fatigue
- tactical fit
- availability

The engine should not recalculate underlying ability.

## Stress-testing scope

Closed-world engine simulations can test:

- goals per match
- home/draw/away balance
- upset rate
- clean sheets
- promotion/relegation volatility
- whether one tactical setup dominates
- squad hoarding in AI-managed scenarios
- ageing-star replacement in AI-managed scenarios
- whether relegated AI clubs sell too slowly
- transfer-market liquidity in AI-managed scenarios

Closed-world simulations **cannot prove**:

- real-life player development
- future real-life market value movement
- future SoccerWiki/Transfermarkt updates
- future human manager transfer decisions
- long-term scouting accuracy against reality

Those things are governed by fresh real-world data and human manager behaviour, not by the match engine.

## Human-manager worlds

In a live TBG world, transfers are mainly driven by real managers. AI-manager behaviour should be stress-tested only for:

- vacant clubs
- caretaker clubs
- bot-only test worlds
- fallback market liquidity
- emergency squad repair

## Engine integration target

The next engine milestone is to load a `world-state.schema.json` compatible snapshot and run:

1. fixture simulation
2. league table generation
3. cup progression
4. current-state changes
5. closed-world diagnostics

Player development should remain out of scope until there is a specific governance decision to add fictional development.
