# Legacy rating-calibration sources

SoccerWiki and SMW-derived datasets were used during the historical calibration and validation of the TBG rating model. They are not active inputs to current ratings, veteran adjustments, player eligibility, database refreshes or publication.

The live rating pipeline is:

1. Transfermarkt-derived player data
2. TBG rating model
3. TBG veteran reality adjustment
4. Publication eligibility checks
5. Player pools and initial squads
6. Published player database and Pink Final

Legacy scripts and calibration files may remain in the repository for reproducibility and historical reference, but they must not be added to the canonical rebuild workflow without an explicit governance decision.
