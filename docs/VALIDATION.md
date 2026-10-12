# Office trading release validation — 2026-10-12

## Automated checks

- Production build and TypeScript validation.
- Prettier formatting check.
- Unit coverage: navigation around office furniture/partitions, animation interpolation, save migration, authenticated model transport, paper fill accounting, long/short costs, stop/take ordering, gaps, elimination/cancellation, CSV validation, historical observation boundaries, and local-time/weather mapping.
- Desktop Chromium and Pixel 5 emulation: orbit/pinch/pan, selection, save/restore, offline reload, model settings, errors, CSV import, paper tests, ledger export, weather success, eliminated-agent rendering, valid model trades, failed-model HOLD and cancellation.
- Model transport in automated tests is mocked and labeled. No live ChatGPT entitlement or profitable live-model strategy has been verified in this release.
- Headless Chromium uses software WebGL. Device performance and Android WebGPU inference need a physical device check.

## Public market-data smoke test

The public Binance historical data endpoint returned HTTP 200, 1,000 rows, and a browser-compatible CORS header. The currently incomplete candle was removed, leaving **999 closed hourly BTC/USDT bars**. Default held-out evaluation used the last **300 bars**, from **2026-09-29 18:00 UTC to 2026-10-12 05:00 UTC**. Each account started at $10,000, using the exact fixed execution costs and risk rules documented in README.

| Baseline               | Closed trades | Win rate |  Net P&L | Max sampled drawdown |
| ---------------------- | ------------: | -------: | -------: | -------------------: |
| Nova — 8/30 trend      |            14 |    7.14% | −$143.31 |                1.91% |
| Atlas — mean reversion |             7 |   42.86% |  −$55.46 |                0.90% |
| Echo — 20-bar breakout |             9 |   33.33% | −$161.50 |                2.15% |

**All three lost money; none met the research target.** These are fixed-rule results, not AI-model results. The short sample and small trade counts do not establish which market or model performs best. The feed is rolling, so fetching again changes the sample. Synthetic-demo results are separate and never evidence of a market edge. Parameters were not tuned after seeing these results.

## Integration boundaries

TradingView chart links, chart-CSV imports, ledger exports, and a Pine trend-baseline file are implemented. Orders execute in the local paper engine only. TradingView documents that Pine strategies cannot submit orders through its Trading Panel brokers or built-in Paper Trading account. The Pine export uses Strategy Tester, with its own fill conventions; it is not identical execution and does not reproduce model decisions.

Weather is optional Open-Meteo current conditions after explicit browser location permission. Tests mock weather/location. The wall-clock day/night cycle works offline, without location permission.
