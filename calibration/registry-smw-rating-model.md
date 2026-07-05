# Registry-first SMW Rating Model
Version: registry-smw-rating-model-v1.0
Examples: 210
Registry rows: 644
Transfermarkt rows: 644
Score: 91.37/100
Mean error: 0
Mean absolute error: 0.575
Median absolute error: 0.472
Max absolute error: 2.111
Within 1 rating point: 82%
Within 2 rating points: 99%

Skipped:
- No SoccerWiki rating: 434
- No Transfermarkt row: 0
- Out of scope: 0

Position metrics:
- ATT: n=51, MAE=0.516, median=0.402, max=2.066
- DEF: n=92, MAE=0.617, median=0.512, max=2.111
- GK: n=20, MAE=0.707, median=0.623, max=1.781
- MID: n=47, MAE=0.502, median=0.418, max=1.692

Coefficients:
- intercept: 78.47158482
- age: -0.0710923
- ageSquared: 0.00743635
- marketValueMillions: 0.18948928
- logMarketValue: 0.18949086
- marketValueOver10m: -0.11735631
- marketValueOver25m: -0.06509792
- marketValueOver50m: -0.02592103
- marketValueOver80m: -0.00478323
- highestValueMillions: 0.02184292
- logHighestValue: 0.13142675
- previousValueMillions: 0.04344371
- marketTrend: -0.07859023
- internationalCaps: 0.0090537
- internationalGoals: -0.01188723
- totalTransferFeesMillions: -0.00187118
- heightCm: 0.00058824
- hasMarketValue: 0
- isGK: 0.19891137
- isDEF: 0.04237022
- isMID: 0.02806681
- isATT: -0.2693484

Biggest misses:
Player                   Club                     Pos Pred SMW Diff   MV
Lucas Digne              Aston Villa              DEF 88.89  91 -2.111 mmm6
Igor Thiago              Brentford FC             ATT 90.07  88  2.066 mm65
Matty Cash               Aston Villa              DEF 89.13  91 -1.869 mm22
Joe Rodon                Leeds United             DEF 88.79  87  1.789 mm18
Ben Davies               Tottenham Hotspur        DEF 88.78  87  1.781 mmm3
David Raya               Arsenal FC               GK  91.22  93 -1.781 mm30
Luke Shaw                Manchester United        DEF  88.3  90 -1.698 mmm8
Rayan Cherki             Manchester City          MID 90.31  92 -1.692 mm90
Fabian Schär             Newcastle United         DEF 88.37  90 -1.626 mmm4
Martin Dúbravka          Tottenham Hotspur        GK  88.62  87  1.618 mmm1
Dominic Calvert-Lewin    Leeds United             ATT  89.6  88  1.599 mm22
Pascal Gross             Brighton & Hove Albion   MID 88.42  90 -1.582 mmm3
James Garner             Everton FC               DEF 89.53  88  1.527 mm45
Jeremie Frimpong         Liverpool FC             DEF 89.49  91 -1.509 mm35
William Saliba           Arsenal FC               DEF 92.52  94 -1.476 m100
Giorgi Mamardashvili     Liverpool FC             GK  89.55  91 -1.449 mm28
Yéremy Pino              Crystal Palace           ATT 88.56  90 -1.441 mm30
Bernd Leno               Fulham FC                GK  89.44  88  1.437 mmm6
Ismaïla Sarr             Crystal Palace           ATT 90.43  89   1.43 mm40
Curtis Jones             Liverpool FC             MID 89.58  91  -1.42 mm35
Luka Vušković            Tottenham Hotspur        DEF 89.36  88  1.358 mm60
Wesley Fofana            Chelsea FC               DEF 89.35  88  1.351 mm28
Mason Mount              Manchester United        MID 90.35  89  1.349 mm25
Gabriel Magalhães        Arsenal FC               DEF 92.69  94 -1.306 mm75
Jérémy Doku              Manchester City          ATT 90.71  92 -1.289 mm75
