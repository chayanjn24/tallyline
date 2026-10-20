# Metrics and definitions

The API returns only additive sums. Every rate is computed from those sums in `web/js/metrics.js`, so a total row is a true total and never an average of row averages.

## The funnel
| Metric | Meaning |
|---|---|
| Opportunities | Ad slots publishers offer. Counted on the supply side, before any deal sees the traffic |
| Bid requests | Requests sent to buyers. One opportunity goes to every deal on its placement, so requests > opportunities |
| Bids | Requests a buyer answered with a bid |
| Wins | Bids that won the auction |
| Impressions | Wins that rendered an ad |
| Video starts / completes | Video and CTV only |

## Money
| Metric | Formula |
|---|---|
| Revenue | What buyers pay (gross) |
| Payout | What publishers receive |
| Margin | Revenue − payout; margin % = margin ÷ revenue |
| eCPM | Revenue × 1,000 ÷ impressions |
| RPMR | Revenue per million bid requests: revenue × 10⁶ ÷ requests |
| Opp eCPM | Revenue × 1,000 ÷ opportunities |

## Rates
| Metric | Formula |
|---|---|
| Bid rate | Bids ÷ bid requests |
| Win rate | Wins ÷ bids |
| Fill | Impressions ÷ bid requests |
| Opp fill | Impressions ÷ opportunities |
| Completion % | Completes ÷ starts |
| Avg QPS | Bid requests ÷ (hours × 3,600); the live hour counts as the share elapsed |

## Comparison windows
| Range | Compared with |
|---|---|
| Today / any single day | The day before |
| This week (Mon → today) | The same days last week |
| Last week | The week before |
| Month to date | Last month, day 1 to the same day (capped at month end) |
| Last month | The month before |
| Custom, N days | The N days before |

**Completed hours only.** While a range is still running, both sides are cut at the start of the live hour, so today until 17:00 is compared with yesterday until 17:00. The headline number still includes the live hour; the Δ never does.

## Filters
Six levels: demand partner, demand source, deal, publisher, placement and app. Levels combine with AND; values within a level combine with OR (at most 50). Opportunities show n/a under any demand-side filter, because an opportunity is offered before it is split across buyers.

## Colour
Green means good and red means bad, decided in one function (`tone()` in `web/js/format.js`). For cost-type metrics (payout), up is bad.
