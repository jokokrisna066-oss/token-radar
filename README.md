# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/jokokrisna066-oss/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/jokokrisna066-oss/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for protocols that record no token yet, for make.fun's
[token-radar-01](https://make.fun/bounty/token-radar-01) bounty.

The board ranks pre-token protocols by an implied value derived only from the snapshot's
own figures. The value multiple is not a constant: the program learns it from the snapshot
at run time, taking the median of `mcap_usd / tvl_usd` over every protocol that already
records a token, grouped by category, and falling back to the pooled median for a category
with fewer than four observations. A protocol whose token already trades is never ranked —
it is shown apart, at its recorded market value.

Protocols in `CEX`, `Bridge`, `Canonical Bridge`, `Liquid Staking`, `Liquid Restaking` and
`Restaked BTC` are excluded from the ranking: each is a wrapped, staked or bridged product
of a token that already trades, which the snapshot's own watchlist rule says.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only, no network, no build step, deterministic: the same snapshot
writes the same bytes. It reads the sealed snapshot, writes `out/board.json` and `out/data.js`,
copies `dashboard/` and `screenshots/` into the output, and writes `out/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=8jdc4key&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
