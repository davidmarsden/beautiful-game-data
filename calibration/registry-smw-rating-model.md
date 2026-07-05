# Registry-first SMW Rating Model
Version: registry-smw-rating-model-v2.0
Philosophy: SMW-equivalent benchmark model plus independent TBG Rating Model v2 adjustment layer.
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

TBG Rating Model v2:
- Basis: SMW-equivalent calibration score plus small, auditable objective adjustments.
- Adjustment cap: ±1.25
- Current signals: age, current market value, previous market value, peak market value, position group
- Future signals: minutes, recent form, injury history, league strength, club strength, European/international performance, versatility

Skipped:
- No SoccerWiki rating: 434
- No Transfermarkt row: 0
- Out of scope: 0

Disagreement audit:
- Aligned: 109
- Minor difference: 75
- SoccerWiki higher than TBG: 15
- TBG higher than SoccerWiki: 11

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

Material disagreements:
Player                   Club                     Pos  SMW-Eq TBG SMW ΔTBG Type
Lucas Digne              Aston Villa              DEF     89  89  91    -2 smw_higher_than_tbg
Igor Thiago              Brentford FC             ATT     90  90  88     2 tbg_higher_than_smw
Matty Cash               Aston Villa              DEF     89  89  91    -2 smw_higher_than_tbg
Joe Rodon                Leeds United             DEF     89  89  87     2 tbg_higher_than_smw
Ben Davies               Tottenham Hotspur        DEF     89  88  87     1 tbg_higher_than_smw
David Raya               Arsenal FC               GK      91  91  93    -2 smw_higher_than_tbg
Luke Shaw                Manchester United        DEF     88  88  90    -2 smw_higher_than_tbg
Rayan Cherki             Manchester City          MID     90  91  92    -1 smw_higher_than_tbg
Fabian Schär             Newcastle United         DEF     88  88  90    -2 smw_higher_than_tbg
Martin Dúbravka          Tottenham Hotspur        GK      89  88  87     1 tbg_higher_than_smw
Dominic Calvert-Lewin    Leeds United             ATT     90  90  88     2 tbg_higher_than_smw
Pascal Gross             Brighton & Hove Albion   MID     88  88  90    -2 smw_higher_than_tbg
James Garner             Everton FC               DEF     90  90  88     2 tbg_higher_than_smw
Jeremie Frimpong         Liverpool FC             DEF     89  89  91    -2 smw_higher_than_tbg
William Saliba           Arsenal FC               DEF     93  93  94    -1 smw_higher_than_tbg
Giorgi Mamardashvili     Liverpool FC             GK      90  90  91    -1 smw_higher_than_tbg
Yéremy Pino              Crystal Palace           ATT     89  89  90    -1 smw_higher_than_tbg
Bernd Leno               Fulham FC                GK      89  89  88     1 tbg_higher_than_smw
Ismaïla Sarr             Crystal Palace           ATT     90  90  89     1 tbg_higher_than_smw
Curtis Jones             Liverpool FC             MID     90  90  91    -1 smw_higher_than_tbg
Luka Vušković            Tottenham Hotspur        DEF     89  90  88     2 tbg_higher_than_smw
Wesley Fofana            Chelsea FC               DEF     89  89  88     1 tbg_higher_than_smw
Mason Mount              Manchester United        MID     90  90  89     1 tbg_higher_than_smw
Gabriel Magalhães        Arsenal FC               DEF     93  93  94    -1 smw_higher_than_tbg
Jérémy Doku              Manchester City          ATT     91  91  92    -1 smw_higher_than_tbg

TBG v2 largest adjustments:
Player                   Club                     Pos SMW-Eq Adj  TBG Reasons
Junior Kroupi            AFC Bournemouth          ATT     88   0.7  89 +0.45: teenage elite-potential premium | +0.25: strong recent market rise
Carlos Casemiro          Without Club             DEF     91  -0.6  90 -0.35: age-and-current-market decline check | -0.25: large fall from peak market status
Fabian Schär             Newcastle United         DEF     88  -0.6  88 -0.35: age-and-current-market decline check | -0.25: late-career low-market safeguard
Harry Maguire            Manchester United        DEF     90  -0.6  89 -0.35: age-and-current-market decline check | -0.25: large fall from peak market status
Pascal Gross             Brighton & Hove Albion   MID     88  -0.6  88 -0.35: age-and-current-market decline check | -0.25: late-career low-market safeguard
Dan Burn                 Newcastle United         DEF     88  -0.6  88 -0.35: age-and-current-market decline check | -0.25: late-career low-market safeguard
Danny Welbeck            Brighton & Hove Albion   ATT     88  -0.6  88 -0.35: age-and-current-market decline check | -0.25: late-career low-market safeguard
Jordan Henderson         Brentford FC             DEF     90  -0.6  89 -0.35: age-and-current-market decline check | -0.25: late-career low-market safeguard
Lewis Dunk               Brighton & Hove Albion   DEF     88  -0.6  88 -0.35: age-and-current-market decline check | -0.25: late-career low-market safeguard
Matz Sels                Nottingham Forest        GK      88  -0.5  88 -0.35: age-and-current-market decline check | -0.25: late-career low-market safeguard | +0.1: goalkeeper longevity stability
Marco Bizot              Aston Villa              GK      88  -0.5  88 -0.35: age-and-current-market decline check | -0.25: late-career low-market safeguard | +0.1: goalkeeper longevity stability
Martin Dúbravka          Tottenham Hotspur        GK      89  -0.5  88 -0.35: age-and-current-market decline check | -0.25: late-career low-market safeguard | +0.1: goalkeeper longevity stability
Jorrel Hato              Chelsea FC               DEF     88  0.45  89 +0.45: teenage elite-potential premium
Leny Yoro                Manchester United        DEF     89  0.45  90 +0.45: teenage elite-potential premium
Luka Vušković            Tottenham Hotspur        DEF     89  0.45  90 +0.45: teenage elite-potential premium
Myles Lewis-Skelly       Arsenal FC               MID     88  0.45  88 +0.45: teenage elite-potential premium
Vitor Rayan              AFC Bournemouth          ATT     88  0.45  89 +0.45: teenage elite-potential premium
Erling Haaland           Manchester City          ATT     96  0.35  97 +0.35: world-superstar market signal
Bukayo Saka              Arsenal FC               ATT     94  0.35  95 +0.2: elite market signal | +0.15: early-prime high-ceiling premium
Florian Wirtz            Liverpool FC             MID     93  0.35  94 +0.2: elite market signal | +0.15: early-prime high-ceiling premium

Biggest SMW-equivalent calibration misses:
Player                   Club                     Pos SMW-Eq TBG SMW Diff   MV
Lucas Digne              Aston Villa              DEF  88.89  89  91 -2.111    6m
Igor Thiago              Brentford FC             ATT  90.07  90  88  2.066   65m
Matty Cash               Aston Villa              DEF  89.13  89  91 -1.869   22m
Joe Rodon                Leeds United             DEF  88.79  89  87  1.789   18m
Ben Davies               Tottenham Hotspur        DEF  88.78  88  87  1.781    3m
David Raya               Arsenal FC               GK   91.22  91  93 -1.781   30m
Luke Shaw                Manchester United        DEF   88.3  88  90 -1.698    8m
Rayan Cherki             Manchester City          MID  90.31  91  92 -1.692   90m
Fabian Schär             Newcastle United         DEF  88.37  88  90 -1.626    4m
Martin Dúbravka          Tottenham Hotspur        GK   88.62  88  87  1.618    1m
Dominic Calvert-Lewin    Leeds United             ATT   89.6  90  88  1.599   22m
Pascal Gross             Brighton & Hove Albion   MID  88.42  88  90 -1.582    3m
James Garner             Everton FC               DEF  89.53  90  88  1.527   45m
Jeremie Frimpong         Liverpool FC             DEF  89.49  89  91 -1.509   35m
William Saliba           Arsenal FC               DEF  92.52  93  94 -1.476  100m
Giorgi Mamardashvili     Liverpool FC             GK   89.55  90  91 -1.449   28m
Yéremy Pino              Crystal Palace           ATT  88.56  89  90 -1.441   30m
Bernd Leno               Fulham FC                GK   89.44  89  88  1.437    6m
Ismaïla Sarr             Crystal Palace           ATT  90.43  90  89   1.43   40m
Curtis Jones             Liverpool FC             MID  89.58  90  91  -1.42   35m
Luka Vušković            Tottenham Hotspur        DEF  89.36  90  88  1.358   60m
Wesley Fofana            Chelsea FC               DEF  89.35  89  88  1.351   28m
Mason Mount              Manchester United        MID  90.35  90  89  1.349   25m
Gabriel Magalhães        Arsenal FC               DEF  92.69  93  94 -1.306   75m
Jérémy Doku              Manchester City          ATT  90.71  91  92 -1.289   75m
