# Fieldwork — Android AI World

A mobile-first, explorable low-poly island with three autonomous residents: **Nova** (Explorer), **Atlas** (Caretaker), and **Echo** (Connector). Built with Three.js, HTML, CSS, and TypeScript compiled to JavaScript by Vite. The initial repository was empty.

The MVP uses **deterministic local rules**, not language models. It requires no account, paid service, API key, textures, or remote model downloads. The agents have no final objective yet: this is a foundation for your later multi-agent experiment.

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
   npm run preview
   ```

3. Leave Termux running and open **http://127.0.0.1:4173** in Android Chrome.

Node.js **20.19+ or 22.12+** is required by Vite; current Termux `nodejs-lts` meets this requirement. The server binds only to your phone's loopback address. The application is not automatically published to a public URL.

### Start it again / use it offline

Once installed and built, these commands need no internet:

```sh
cd ~/Office-Environment
npm run preview
```

Open **http://127.0.0.1:4173** again. Keep the same host and port: browser saves are scoped to the origin. The `dist/` output contains all runtime assets; no CDN is used. A generated service worker also caches the complete production build after a successful visit. Allow the first load to finish, then reload once before relying on the cached page with the server stopped. If Chrome offers **Add to Home screen / Install**, it can launch as an app from the local secure origin. Availability depends on browser version; using Chrome directly always works.

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
npm run preview
```

Reload the page after updating. A new service worker waits until tabs using the old version are closed; close and reopen the app if needed. Browser storage is preserved unless you clear site data or reset the world.

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

On narrow screens, **World / Agents / Journal** tabs keep controls readable. The journal filters conversations; selecting an agent shows state, latest action, energy, and recent memory. Paths avoid buildings and the lake, and agents remain inside the island. Visual trees are decorative and not navigation obstacles. Agents can share space; this MVP does not include crowd collision avoidance.

## What's included

- Procedural island terrain, 42 low-poly trees, rocks, paths, field station, research lab, lake, garden, greenhouse, and meeting circle.
- Three animated characters that wander, visit places, observe, interact, rest, and exchange messages through the simulation's event bus.
- Local observations (18-meter places / 9-meter neighbors), per-agent memory (12 entries), visit counts, energy, and a bounded world journal (80 events).
- Simulation time, pause/resume, speed controls, touch camera, selection, and manual guide/greeting actions.
- Versioned localStorage snapshots restoring positions, ongoing movement, energy, memories, visit/interaction counts, events, elapsed time, and playback settings. Autosave runs every 10 seconds and on page hide; corrupt/blocked storage is handled visibly.
- Economy mode by default: 1× maximum pixel ratio, no real-time shadow maps, instanced trees, scenery merged by material, 20 Hz simulation, rendering capped at 30 FPS, and suspension while the document is hidden. Detailed mode adds shadows and caps pixel ratio at 1.5.
- An offline production cache and installable web manifest. There are no personal-data, phone-control, or external-model permissions.

## Modular architecture

```text
src/
  main.ts           Bootstrap, render loop, controls, autosave
  world.ts          Three.js geometry, lighting, touch camera, picking
  agent.ts          Movement, energy, action lifecycle
  simulation.ts     Authoritative state, event bus, orchestration
  clock.ts          SimulationClock: pause, speed, elapsed time
  actions.ts        Bounded action validation
  navigation.ts     Walkable ground and grid pathfinding
  observation.ts    Limited local observations
  memory.ts         Bounded short-term memory
  ai-provider.ts    AIProvider interface, local rules, per-agent router
  persistence.ts    Versioned saves, validation, error recovery
  config.ts         World layout, points of interest, initial agents
  types.ts          Shared world, action, observation, snapshot types
  ui.ts / style.css Responsive controls and journal
public/             Local icon and PWA manifest
scripts/build-sw.mjs Production asset-cache generation
scripts/serve.mjs    Dependency-free static production server
tests/             Simulation and browser tests
```

### Connect models later

Implement `AIProvider` with `id`, `label`, `mode: 'model'`, and `decide(observation, signal)`. Register multiple providers through `simulation.providers.register(adapter)` and assign them independently with `assign(agentId, providerId)`. `ProviderRouter` supports a 4-second timeout, cancellation, a 6-request/minute budget **per agent**, and automatic local-rule fallback on provider failure, invalid actions, or exhausted budgets. Calls are limited to one in flight per agent; no retries are sent automatically. Budgets apply across providers for that agent. Reset/load cancels old decisions so late responses cannot mutate the new world.

Providers return exactly one bounded action:

```ts
{ type: 'MOVE_TO', target: { x: 6, z: 3 } }
{ type: 'OBSERVE' }
{ type: 'SAY', message: 'Hello' }       // 1–160 characters
{ type: 'WAIT', seconds: 3 }          // 0.5–15 seconds
{ type: 'INTERACT', poiId: 'plaza' }   // must be within 2 meters
```

The engine validates actions and performs navigation; provider outputs cannot directly change state. Inputs are copied observations, not shared mutable objects. Use a user-controlled backend/proxy or local model bridge for future integrations. **Do not put secret API keys in browser code.** No model adapter is connected in this MVP. When connecting models, also update the UI's simulation label to accurately identify which agents use model decisions.

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

The browser suite checks desktop and Pixel 5 emulation: rendering, selection, pause/speed, autonomous movement, greeting/journal, persistence, reset, corrupt saves, blocked storage, and offline reload. It injects Chromium multi-touch gestures. Headless checks use software WebGL; they do not establish physical Android GPU performance. Playwright browser setup is intended for a supported desktop/Linux test environment, not required to run the app in Termux.

### Android smoke test

Open the built app in Chrome. Check that all three agents appear and move; orbit, pinch, and pan; select a resident, guide them to open ground, send a greeting, and inspect the journal. Pause, switch to 4× and resume. Save, refresh, and check memories and positions. Enable airplane mode after loading the production build and reload. Use Economy mode if the FPS counter is low; Detailed mode is optional. Reset should produce a new world after confirmation.

### Troubleshooting

- **Connection refused:** keep Termux's server running. Check that Chrome uses exactly `http://127.0.0.1:4173`. Android may stop Termux in the background; exempt Termux from battery restrictions or restart the server.
- **Blank scene / WebGL message:** update Chrome, close other graphics-heavy tabs, and reload. WebGL is required; GPU/context failures show an explanatory message.
- **Build fails:** check `node --version` meets the requirement, run `pkg upgrade`, then `npm ci --include=dev` again. npm install needs network access; the built app does not.
- **Missing save:** use the same browser and origin. Incognito, cleared site data, or blocked storage prevent durable saves. The app reports storage errors and continues running.
- **Old page after update:** close existing app tabs and reopen so the waiting service worker can activate. If needed, clear the service worker in browser site settings; clearing all site data also deletes the world save.

The next design decision is the agents' ultimate goal. This MVP deliberately leaves that objective open.
