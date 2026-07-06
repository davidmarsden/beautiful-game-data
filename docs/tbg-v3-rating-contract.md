# TBG v3 Rating Contract

TBG v3 separates sticky player ability from fluid match state.

## Principle

> Ability is sticky. Form is fluid.

The data repository owns underlying ability. The engine repository owns fixture-by-fixture performance state.

## Data-owned fields

Each exported player in `derived/tbg-player-pools/*.json` includes:

```json
{
  "tbg_player_id": "tbg-tm-00342229",
  "transfermarkt_id": "342229",
  "display_name": "Kylian Mbappé",
  "position_group": "ATT",
  "tbg_rating": 99,
  "underlying_ability_rating": 99,
  "effective_match_rating": 99,
  "current_state_total_modifier": 0,
  "ability_profile": {},
  "current_state": {},
  "engine_profile": {}
}
```

`tbg_rating` remains as a backwards-compatible alias of `underlying_ability_rating`.

## Sticky ability

`ability_profile` explains how the underlying ability rating was produced:

- `base_smw_equivalent_rating`
- `ability_component`
- `prestige_component`
- `elite_trajectory_component`
- `total_sticky_adjustment`
- `underlying_ability_rating`
- `explanation.reasons`
- `explanation.reasons_by_component`

The phrase `elite_trajectory_component` should be read as evidence-based current ability uplift, not speculative potential. It is for players whose age, minutes, responsibility, market consensus and performance already indicate they are outperforming the historic SMW/SW calibration.

## Fluid match state

The default current state is neutral:

```json
{
  "form_modifier": 0,
  "fitness_modifier": 0,
  "match_sharpness_modifier": 0,
  "morale_modifier": 0,
  "fatigue_modifier": 0,
  "tactical_fit_modifier": 0,
  "availability_modifier": 0,
  "total_modifier": 0
}
```

The match engine should replace those values before each fixture.

## Engine formula

At fixture time:

```text
effective_match_rating = clamp(
  underlying_ability_rating
  + form_modifier
  + fitness_modifier
  + match_sharpness_modifier
  + morale_modifier
  + fatigue_modifier
  + tactical_fit_modifier
  + availability_modifier,
  40,
  99
)
```

This allows a 92 ability veteran to perform like an 89 when unfit or out of rhythm, without permanently destroying his football ability. It also allows exceptional young players to play if their current evidence supports it, instead of being trapped below usability by age-only calibration.
