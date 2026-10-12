# AURELIUS — Capital Lab

A mobile-friendly 3D **office building**, with a dark navy, brass and walnut trading-floor style. The old island is replaced by Research, Strategy Lab, Risk Control, Execution and an Investment Committee. Nova, Atlas and Echo run independent $10,000 paper accounts. Built with Three.js and TypeScript/JavaScript; no paid service or API key is required to open the office or run baseline backtests.

**This app executes historical paper trades locally. It does not connect to or place orders in TradingView's built-in Paper Trading account.** TradingView [documents that Pine strategies cannot place those orders](https://www.tradingview.com/pine-script-docs/faq/strategies/). The integration is chart links, OHLC CSV import, trade-ledger CSV export, and a downloadable Pine trend baseline for Strategy Tester. The Pine script is not an AI agent and its tick-based slippage/fill semantics differ from this engine. No live broker, exchange order endpoint, or real-money trading is connected.

## Research workflow

1. Open **Trading** on mobile, or scroll to **Open the research desk** on desktop.
2. Fetch up to 1,000 public **BTC/USDT hourly candles**, or enter another symbol and import an OHLC CSV. BTC is the first data source because it is accessible, not because we have established that it performs best. Compare markets using equal time spans, costs and genuinely unseen evaluation periods.
3. Choose **Fixed baselines · not AI** to test the engine, or **Assigned AI models** to use the models selected in AI models. Nova's baseline is an 8/30-period trend filter; Atlas uses mean reversion; Echo uses a 20-bar breakout. These fixed policies do not learn or optimize.
4. Default evaluation uses the **last 30%** of bars. The preceding bars supply indicator context; parameters are not fitted to the evaluation period. Full-sample mode is explicitly exploratory. CSVs must contain 100–10,000 ascending, unique bars with `time,open,high,low,close` and optional `volume`. Unix seconds, milliseconds and ISO times are accepted; extra TradingView indicator columns are ignored. Use ordinary OHLC candles, not synthetic chart types.
5. **Run test** steps through historical candles. Decisions see completed bars only (at most 50 for models); execution starts at the next unseen bar's open. AI requests run sequentially with a 20-second gap between cycles to limit model usage. Missing/failed/invalid models produce a labeled **HOLD**, never hidden rule-based trading. Office routines use local rules while a trading run is active. **Pause test** aborts outstanding requests; late responses are discarded. The office animation pause is separate from the backtest pause.
6. Inspect equity, net P&L, win rate, profit factor, closed trades, drawdown and the ledger. Export the ledger before **New test**, which resets paper capital and eliminations. Changing mode or evaluation after execution starts requires a new test. Replacing the dataset also starts new accounts.

Each account starts with **$10,000**. Risk control limits entries to **0.5% balance risk** at a **2% stop**, capped at **25% notional exposure**, with a **4% take-profit** and one position per account. Both long and short positions are modeled without leverage; short borrow/funding costs are not modeled. Fills include **0.10% fees per side** and **0.05% adverse slippage per fill**. Gaps through a stop execute at the adverse open. When OHLC touches both stop and target, the stop is taken first. Open positions are marked at candle close and liquidated at sample end. Maximum drawdown tracks sampled equity (open/close/exit), not every intrabar tick. Volume, liquidity impact, latency, funding, dividends and corporate actions are not simulated.

At **$8,000 equity or below**, the agent is **eliminated**, its position closes, it stops acting/trading and disappears from the active floor. Death persists through reload. New test starts a new cohort. This is a simulated capital-loss rule, not a claim about model fitness beyond the current sample.

The **>85% win-rate goal** is a research target, **not an achieved or guaranteed return**. The dashboard only calls the sample target met after a completed held-out test with at least **100 closed trades per partner**, positive net profit, >85% wins and survival. This threshold is not statistical proof. Repeatedly selecting strategies/markets on the same holdout contaminates it; validate on fresh data. Historical LLM tests can also be contaminated by pretrained knowledge of historical prices despite past-only prompts. Synthetic demo results never count as market evidence.

The three real model adapters remain **GPT‑6.1‑sol** through your ChatGPT/Codex plan connection, plus **Qwen2.5 0.5B** and **SmolLM2 135M** through local WebLLM. Sign-in eligibility/allowance and WebGPU hardware still determine availability. No model is labeled as having traded successfully until it returns a valid trading action. Historical model results are not proof of live profitability.

## Time, weather, and saves

Office lighting follows the **device's local wall clock**, independent of simulation speed/pause: day, golden hour and night. It is a time-based ambience, not a calculated astronomical sunrise. Press **Local weather** to grant browser geolocation and fetch current conditions from [Open-Meteo](https://open-meteo.com/en/docs). Approximate coordinates rounded to 0.01° are sent to Open-Meteo, kept only in memory, and refreshed every 15 minutes. The app never requests location at startup. Rain/snow appears outside the windows; weather failure is visible and leaves clock lighting working. Free Open-Meteo access is for non-commercial use; no key is needed for this personal prototype.

Office state uses `aurelius.office.v1`; trading data, positions, account deaths and results use `aurelius.trading.v1`. Both save locally. Old island saves are left intact; compatible model assignments and memories migrate while office positions/routes reset. Trading resumes **paused** after reload. Saves do not sync across devices. The offline build works for existing data/baselines; fetching candles, weather and GPT needs connectivity. Model weights have a separate cache.

## Windows CMD setup / update

Install current [Node.js LTS](https://nodejs.org/) and [Git](https://git-scm.com/download/win), then reopen CMD. If a server is running, press **Ctrl+C** first. Enter each line:

```cmd
cd /d "%USERPROFILE%"
if not exist "Office-Environment" git clone https://github.com/markleotest-commits/Office-Environment.git
cd Office-Environment && git pull --ff-only && npm ci --include=dev && npm run build && npm run start:ai
```

Keep CMD open and visit **http://127.0.0.1:4173** in Chrome or Edge. Close/reopen old app tabs after an update to activate the new offline cache. `127.0.0.1` always means the device running the browser; install and run the repository separately on each device.

## Open on an Android phone (no computer required)

1. Install a current **Termux** from [F-Droid](https://f-droid.org/packages/com.termux/) or the [official Termux releases](https://github.com/termux/termux-app/releases). Open Termux.
2. Paste these commands. Initial setup needs internet access:

   ```sh
   pkg update -y
   pkg install -y nodejs-lts git
   git clone https://github.com/markleotest-commits/Office-Environment.git
   cd Office-Environment
   npm ci --include=dev
   npm run build
   npm run start:ai
   ```

3. Leave Termux running and open **http://127.0.0.1:4173** in Android Chrome.

Node.js **20.19+ or 22.12+** is required by Vite; current Termux `nodejs-lts` meets this requirement. The server binds only to your phone's loopback address. The application is not automatically published to a public URL.

### Start it again / use it offline

Once installed and built, these commands need no internet:

```sh
cd ~/Office-Environment
npm run start:ai
```

Open **http://127.0.0.1:4173** again. Keep the same host and port: browser saves are scoped to the origin. The `dist/` output contains the sandbox's runtime assets; no CDN is needed to explore the world. Local AI model weights require a separate download described below. A generated service worker caches the complete production build after a successful visit. Allow the first load to finish, then reload once before relying on the cached page with the server stopped. If Chrome offers **Add to Home screen / Install**, it can launch as an app from the local secure origin. Availability depends on browser version; using Chrome directly always works.

For development with hot reload:

```sh
cd ~/Office-Environment
npm run dev
```

Open **http://127.0.0.1:5173**. Development mode does not register an offline cache. The development origin has a separate save from the production preview origin.

To update later, stop the server with Ctrl+C, then run:

```sh
cd ~/Office-Environment
git pull --ff-only
npm ci --include=dev
npm run build
npm run start:ai
```

Reload the page after updating. A new service worker waits until tabs using the old version are closed; close and reopen the app if needed. Browser storage is preserved unless you clear site data or reset the world.

## Enable the real AI models on Android

If you already cloned the repository, stop the old server with Ctrl+C and paste:

```sh
cd ~/Office-Environment
git pull --ff-only
npm ci --include=dev
npm run build
npm run start:ai
```

Open **http://127.0.0.1:4173** in Chrome. This uses the same origin as the original preview, preserving world saves. Keep Termux running.

1. Tap **AI models** at the top.
2. Tap **Continue with ChatGPT**. Complete OpenAI's sign-in and allow this app to use your ChatGPT plan. This app creates its own registered connection; being signed into the ChatGPT app alone does not connect the simulation. On return, **Check connection** verifies that `gpt-6.1-sol` is listed for the selected account.
3. Open **Manage usage** and keep **app credit use disabled** to stay within the allowance already included in your plan. GPT‑6.1‑sol is not an unlimited free API. Your existing plan limits still apply; the app does not create a paid API-key connection or change your credit settings. OpenAI controls whether an account is eligible for plan usage. [Official plan-usage documentation](https://developers.openai.com/siwc/token-sharing-open-source).
4. Tap **Load Qwen** and **Load SmolLM** and wait for **Ready**. Downloads come from Hugging Face and MLC's published model libraries. Their weights are cached separately from the application. The first download needs internet; cached local models can run offline afterward.
5. Tap **GPT + Qwen + SmolLM**, then **Apply model choices**. This assigns Nova to GPT‑6.1‑sol, Atlas to Qwen, and Echo to SmolLM. Each agent finishes its current action before requesting the next model decision. You can also choose assignments individually.

GPT access is confirmed only after a complete model response; the dialog then reports that a real decision completed. The agent panel shows **Assigned**, **Last source**, model-decision count, fallback count, and the reason for a fallback. A selected model name alone is not proof of live inference. Quota failures, invalid actions, network errors, and timeouts fall back visibly to local rules; there is no substitute paid model.

### Phone requirements and local-model limitations

On-device inference requires a browser with **WebGPU**, a compatible GPU, and sufficient RAM/storage. Android Chrome support varies by phone; the loader reports unavailable adapters and load failures. The two models together can require more than **1 GB GPU memory** (more without half-precision support), plus Chrome and the 3D world. Model downloads are hundreds of megabytes, not part of the small world geometry. Try **SmolLM alone assigned to both Atlas and Echo** on a modest phone. Economy graphics is recommended while models run.

The loader selects compatible 16-bit or 32-bit WebLLM variants, limits context to 2,048 tokens, runs inference in workers, and serializes local generation to reduce concurrent GPU load. Small models can make poor decisions; the engine validates every action. Downloads time out after 10 minutes with retryable cached assets. Cancelling a running generation terminates its worker and requires **Load** again. You can **Unload** a local model to release memory.

Selections persist in world snapshots. After reopening, press **Load** for any saved local-model assignments; cached weights are reused, and the app does not automatically initiate large downloads. GPT needs internet and the AI server running; sign-in credentials refresh locally while valid. The original `npm run start:ai` and static server still run the sandbox and local models, but cannot provide ChatGPT sign-in. Backend requests are excluded from the offline service-worker cache.

### Local sign-in storage and controls

The Node bridge binds to `127.0.0.1` only. It uses a session cookie, origin/Host checks, CSRF validation, request limits, PKCE, one-time browser-bound state, nonce validation, and signature-verified ID tokens. OAuth credentials are stored outside the repository at **`~/.config/fieldwork/accounts.json`** with owner-only permissions; no OAuth tokens go into browser storage, source files, or logs. Different saved account registrations remain separate, and returning sign-ins reuse the client registration and stable host ID.

**Sign out** clears local tokens and attempts remote session revocation while retaining the non-secret account registration for later sign-in. If revocation cannot be confirmed, the app directs you to disconnect Fieldwork in ChatGPT settings. Environment overrides `FIELDWORK_PORT` and `FIELDWORK_DATA_DIR` select a different local port or protected data directory; changing the port changes the browser-save origin. Run only one AI server against a given data directory.

The bridge supports only the exact **`gpt-6.1-sol`** model. It reads your account-specific catalog and sends `store: false`, `stream: true`, low reasoning effort, a structured action schema, and no external tools. It consumes the stream through `response.completed` before applying an action. A catalog entry is not a guarantee that a particular request will be allowed. GPT calls are capped at **6 per minute across the server**, with one in flight, and a 55-second server timeout. Frontend budgets are **6 decisions per minute per agent** (wall time), independent of simulation speed. GPT's provider timeout is 60 seconds; local models have 90 seconds. There are no automatic paid fallbacks or inference retries.

Sources: [OpenAI model/stream requirements](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), and [WebLLM documentation](https://webllm.mlc.ai/docs/).

## Controls

| Action              | Phone                                | Desktop                               |
| ------------------- | ------------------------------------ | ------------------------------------- |
| Orbit camera        | One-finger drag                      | Left-drag                             |
| Pan                 | Two-finger drag                      | Right-drag                            |
| Zoom                | Pinch or + / − buttons               | Scroll or + / −                       |
| Select agent        | Tap character/name, or Agents tab    | Click character/name or resident card |
| Center on agent     | Focus button in agent panel          | Same                                  |
| Move selected agent | Guide agent, then tap open ground    | Same                                  |
| Send a greeting     | Say hello (heard within 9 meters)    | Same                                  |
| Pause/resume, speed | Playback bar: ½×, 1×, 2×, 4×         | Same                                  |
| Restore camera      | Focus icon below zoom buttons        | Same                                  |
| Save/load/reset     | Bottom bar; reset has a confirmation | Same                                  |

On narrow screens, **Floor / Trading / Team / Wire** tabs keep controls readable. Paths avoid workstation banks and glass partitions, and agents remain inside the office. Agents can share space; crowd collision avoidance is not implemented.

## What's included

- A cutaway high-rise office, city-facing windows, glass partitions, walnut desks, monitors, chairs, department labels and suited low-poly partners.
- Three animated characters that wander, visit places, observe, interact, rest, and exchange messages through the simulation's event bus.
- Local observations (18-meter places / 9-meter neighbors), per-agent memory (12 entries), visit counts, energy, and a bounded world journal (80 events).
- Simulation time, pause/resume, speed controls, touch camera, selection, and manual guide/greeting actions.
- Versioned localStorage snapshots restoring positions, ongoing movement, energy, memories, visit/interaction counts, events, elapsed time, and playback settings. Autosave runs every 10 seconds and on page hide; corrupt/blocked storage is handled visibly.
- Economy mode by default: 1× maximum pixel ratio, no real-time shadow maps, static office scenery batched with vertex colours. The 20 Hz simulation interpolates movement at up to 60 FPS, with smooth turns, hip/shoulder walking pivots, and eased camera zoom. Obstacle-safe route shortcuts remove grid zigzags; movement preserves its travel budget across waypoints. Labels use transform positioning without per-label layout reads. Rendering stops when the document or mobile world panel is hidden, and behind model settings to leave GPU capacity for models. Detailed mode adds shadows and caps pixel ratio at 1.5. Actual frame rate depends on the device and model workload.
- An offline production cache and installable web manifest. The office works without phone permissions. Optional weather requests location on click; optional GPT access asks for explicit ChatGPT consent.

## Modular architecture

```text
src/
  main.ts           Bootstrap, render loop, controls, autosave
  world.ts          Three.js rendering, touch camera, picking
  office.ts         Cutaway office geometry and furniture
  office.css        Trading-floor design and mobile research desk
  atmosphere.ts     Device-local lighting and optional Open-Meteo weather
  trading.ts        Paper execution, costs, risk, metrics, validated data
  trading-ui.ts     Research desk, model cycles, ledger, trading persistence
  market-data.ts    Public historical candles and labeled synthetic demo
  agent.ts          Movement, energy, action lifecycle
  simulation.ts     Authoritative state, event bus, orchestration
  clock.ts          SimulationClock: pause, speed, elapsed time
  actions.ts        Bounded action validation
  navigation.ts     Walkable ground and grid pathfinding
  observation.ts    Limited local observations
  memory.ts         Bounded short-term memory
  ai-provider.ts    AIProvider interface, local rules, router and source reports
  model-providers.ts ChatGPT bridge client and browser-model adapters
  model-ui.ts       Model choices, sign-in, load/unload controls
  model.worker.ts   WebLLM computation off the UI thread
  persistence.ts    Versioned saves, validation, error recovery
  config.ts         World layout, points of interest, initial agents
  types.ts          Shared world, action, observation, snapshot types
  ui.ts / style.css Responsive controls and journal
server/
  index.mjs         Local HTTP/AI server, sessions and request validation
  openai-plan.mjs   Official OAuth flow, protected token store, GPT SSE
shared/             Common structured action schema and bounded prompt
public/             Local icon and PWA manifest
scripts/build-sw.mjs Production asset-cache generation
scripts/serve.mjs    Dependency-free static production server
tests/             Simulation and browser tests
```

### Connect models later

Implement `AIProvider` with `id`, `label`, `mode: 'model'`, and `decide(observation, signal)`. Register multiple providers through `simulation.providers.register(adapter)` and assign them independently with `assign(agentId, providerId)`. `ProviderRouter` supports provider-specific timeouts (4 seconds by default), cancellation, a 6-request/minute budget **per agent**, and automatic local-rule fallback on provider failure, invalid actions, or exhausted budgets. Calls are limited to one in flight per agent; no retries are sent automatically. Budgets apply across providers for that agent. Reset/load cancels old decisions so late responses cannot mutate the new world.

Office providers return exactly one bounded action. Trading observations use the separate `{ type: 'TRADE', side: 'LONG' | 'SHORT' | 'FLAT' | 'HOLD', message: string }` contract; only the paper engine executes it. Trading calls use the provider adapter directly with cancellation/timeout and HOLD on failure, not the office router's fallback.

Office actions:

```ts
{ type: 'MOVE_TO', target: { x: 6, z: 3 } }
{ type: 'OBSERVE' }
{ type: 'SAY', message: 'Hello' }       // 1–160 characters
{ type: 'WAIT', seconds: 3 }          // 0.5–15 seconds
{ type: 'INTERACT', poiId: 'plaza' }   // must be within 2 meters
```

The engine validates actions and performs navigation; provider outputs cannot directly change state. Inputs are copied observations, not shared mutable objects. Use a user-controlled backend/proxy or local model bridge for future integrations. **Do not put secret API keys in browser code.** The UI reports assigned models separately from actual decision sources. The supplied ChatGPT and browser-model adapters are registered but remain inactive until selected; local rules are the default.

## Run on a computer

```sh
npm ci
npm run dev
```

For a dependency-free static server after building:

```sh
npm run build
node scripts/serve.mjs
```

Open **http://127.0.0.1:4173**. This server uses only built-in Node APIs; `dist/` can also be served by any static HTTP host, including under a subdirectory. Do not open `index.html` using `file://`: ES modules and service workers need an HTTP origin. No hosting or deployment is required.

## Verification

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The browser suite includes office branding, weather success, paper backtests, CSV validation, ledger exports, persisted eliminations, model-trade attribution, failed-model HOLD behavior, and cancellation, on desktop and Pixel 5 emulation. It also checks: rendering, selection, pause/speed, autonomous movement, greeting/journal, persistence, reset, corrupt saves, blocked storage, offline reload, model assignments, unavailable WebGPU, and visible quota fallback through a mocked plan bridge. It injects Chromium multi-touch gestures. Unit tests cover fill accounting, long/short fees and slippage, conservative stops, gaps, elimination, sample isolation, CSV validation, migration, local-time phases, OAuth/PKCE, JWT validation, session protection, rotating refresh, model catalog checks, exact GPT request parameters, and streamed terminal errors. GPT transport tests use clearly marked synthetic credentials and responses; they do not verify your live account entitlement. Headless checks use software WebGL; they do not establish physical Android GPU performance. Playwright browser setup is intended for a supported desktop/Linux test environment, not required to run the app in Termux.

For an optional live free-model check on a desktop/Linux test machine, start `npm run start:ai` in another terminal and run `node scripts/smoke-local-model.mjs`. It downloads SmolLM, runs WebGPU inference in software Chromium, and waits for a validated model decision. Set `FIELDWORK_SMOKE_MODEL=qwen` to check Qwen instead. This check needs internet, substantial memory, and several minutes; it never signs in or calls GPT. `FIELDWORK_SMOKE_ORIGIN` selects a different loopback port and `FIELDWORK_SMOKE_PROXY` optionally supplies a download proxy.

Implementation-machine live check: SmolLM's weights downloaded and loaded successfully, but generation exceeded the 90-second provider limit on the software GPU and was cancelled. Successful local inference on a hardware GPU, physical Android performance, and live GPT account access remain to be verified. Automated GPT responses are mocked; assigning a model is not a live-access test.

### Android smoke test

Open the built app in Chrome. Check that all three agents appear and move; orbit, pinch, and pan; select a resident, guide them to open ground, send a greeting, and inspect the journal. Pause, switch to 4× and resume. Save, refresh, and check memories and positions. Enable airplane mode after loading the production build and reload. Use Economy mode if the FPS counter is low; Detailed mode is optional. Reset should produce a new world after confirmation.

### Troubleshooting

- **Connection refused:** keep Termux's server running. Check that Chrome uses exactly `http://127.0.0.1:4173`. Android may stop Termux in the background; exempt Termux from battery restrictions or restart the server.
- **Failed to fetch during ChatGPT sign-in:** the cached world can open while its AI server is stopped. Check `http://127.0.0.1:4173/api/session` in Chrome: the AI server returns JSON with a `csrf` field (do not share its value). A connection error means restart `npm run start:ai` in the repository folder and keep Termux running; an AURELIUS HTML page means a static preview is running instead of the AI bridge. The app now explains local fetch failures and keeps sign-in errors visible beside the sign-in controls. Once the server responds, tap **Check connection** and retry sign-in. A working local endpoint does not establish access to OpenAI or a model entitlement.
- **Blank page / startup error:** an HTML startup screen now remains visible if the main JavaScript fails to load or run. Tap **Repair app cache** to remove only the app's offline cache and service-worker registration, preserving world saves and downloaded AI weights. If the old version is still blank, try Chrome Incognito at the same URL to check for a cache issue without deleting your saved world. Update Chrome; rebuild in Termux with `npm run build`, then restart `npm run start:ai`. If it persists, report the startup message and the last Termux output. A screenshot alone cannot establish the cause.
- **Blank scene / WebGL message:** update Chrome, close other graphics-heavy tabs, and reload. WebGL is required; GPU/context failures show an explanatory message.
- **Build fails:** check `node --version` meets the requirement, run `pkg upgrade`, then `npm ci --include=dev` again. npm install needs network access; the built app does not.
- **Missing save:** use the same browser and origin. Incognito, cleared site data, or blocked storage prevent durable saves. The app reports storage errors and continues running.
- **Old page after update:** close existing app tabs and reopen so the waiting service worker can activate. If needed, clear the service worker in browser site settings; clearing all site data also deletes the world save.

Next research steps: compare genuinely unseen datasets, add richer market observations, and evaluate stronger local models. Automated orders inside TradingView Paper Trading are not implemented because its documented interface does not support them.
