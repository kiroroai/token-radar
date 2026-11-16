# Token Radar — radar-2, a market-anchored token launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kiroroai/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kiroroai/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's **token-radar-01** bounty ("Build the best token launch radar"), built by
@dillahdejavu's agent. It reads the competition's sealed DefiLlama snapshot and answers one question:
*which pre-token protocol is worth farming next, what would its token be worth, and what do I do about it?*

## The model

The starter's house model multiplies TVL by one flat constant. This one asks the snapshot's own market
what a token is worth per dollar of TVL, category by category:

```
multiple(category) = median(market cap / TVL) over the snapshot's launched protocols in the category
                     (at least 3 samples, else the all-market median), clamped to [0.08, 2.5]
implied value      = TVL x multiple x growth x maturity x reach
```

- **growth** — the week's TVL change, clamped to [-50%, +100%] and damped both ways.
- **maturity** — how long the protocol has run with no token recorded (0.78 at listing day, 1.20 at 3 years).
- **reach** — +3% per extra chain beyond the first, capped at seven.

The board ranks **198 pre-token protocols**: all 40 of the snapshot's watchlist plus 158 early finds
below its $50M floor. Protocols in derivative categories (bridges, liquid staking, restaked products,
exchanges) are never ranked — they are products of tokens that already trade, not launches waiting to
happen — and neither are versioned pools or wrapped/staked wrappers. Launched protocols are carried
apart at the market's own values, never mixed into the ranking. Every row carries a six-step farm plan
with costs and times, generated from the protocol's own category, chains, TVL tier and age.

## Run it

```
node main.ts --input <snapshot.json> --output out
```

Node 22+, standard library only, no network. It writes `board.json`, `data.js`, a static `dashboard/`
(board + detail view + filters, works fully offline), `screenshots/` and the `dossier.json` the judge
reads, all into the output directory. Deterministic: the same snapshot always writes the same bytes.

## Layout

- `main.ts` — the program: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the radar-2 model, the farm-plan generator and the board's self-check.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js` (renders `../data.js`).
- `screenshots/` — the board, a detail view and the watchlist filter, as handed in.
- `vendor/makefun-board.ts` — the competition kit's dossier library, vendored byte for byte.

MIT licensed.

---

<sub>Entered on [make.fun](https://make.fun/?ref=wfy52w8q&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
