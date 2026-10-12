import './style.css';
import './office.css';
import { Atmosphere } from './atmosphere';
import { TradingDesk } from './trading-ui';
import { Simulation } from './simulation';
import { Persistence } from './persistence';
import { World } from './world';
import { shell, UI } from './ui';
import { registerModelProviders, ModelControls } from './model-ui';
import { walkable } from './navigation';
const app = document.getElementById('app')!;
shell(app);
const simulation = new Simulation();
const modelProviders = registerModelProviders(simulation);
// The getter itself can throw when storage is disabled, so defer access until inside Persistence's try/catch.
const persistence = new Persistence({
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
});
const saved = persistence.load();
if (saved.snapshot) simulation.restore(saved.snapshot);
const ui = new UI(simulation);
ui.saveStatus(saved.message);
const modelControls = new ModelControls(
  simulation,
  ui,
  modelProviders.client,
  modelProviders.local,
);
modelControls.onSave = () => {
  const result = persistence.save(simulation.snapshot());
  ui.saveStatus(result.message, result.ok);
  return result.ok ? 'Model choices saved' : result.message;
};
let world: World | null = null;
try {
  world = new World(document.getElementById('viewport')!, simulation.agents);
  const select = (id: string) => {
    ui.select(id);
    world!.select(id);
  };
  ui.onSelect = select;
  world.onSelect = select;
  world.onGround = (point) => {
    if (!ui.guiding) return;
    if (
      !walkable(point) ||
      !simulation.command(ui.selected, { type: 'MOVE_TO', target: point })
    ) {
      ui.toast('Choose open ground, away from desks and office walls.');
      return;
    }
    ui.guiding = false;
    ui.render();
    ui.toast('A new destination. Let’s see where it leads.');
  };
  document
    .getElementById('focus')!
    .addEventListener('click', () =>
      world!.focus(ui.selected, simulation.agents),
    );
  document
    .getElementById('camera-reset')!
    .addEventListener('click', () => world!.resetCamera());
  document
    .getElementById('zoom-in')!
    .addEventListener('click', () => world!.zoom(0.8));
  document
    .getElementById('zoom-out')!
    .addEventListener('click', () => world!.zoom(1.25));
  document
    .getElementById('quality')!
    .addEventListener('change', (event) =>
      world!.setQuality((event.target as HTMLSelectElement).value === 'low'),
    );
  world.renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    simulation.clock.paused = true;
    showWorldError(
      'Graphics paused because the browser lost its WebGL context. Reload this page to restore your saved world.',
    );
    save(false);
    ui.render();
  });
} catch {
  simulation.clock.paused = true;
  showWorldError(
    'This browser could not start WebGL. Try current Android Chrome, enable hardware acceleration, or close other graphics-heavy tabs and reload.',
  );
  ui.render();
}
const atmosphere = new Atmosphere(world);
const tradingDesk = new TradingDesk(simulation, ui, world);
function showWorldError(message: string) {
  const element = document.getElementById('world-error')!;
  element.hidden = false;
  element.textContent = message;
}
function save(notify = true) {
  const result = persistence.save(simulation.snapshot());
  ui.saveStatus(result.message, result.ok);
  if (notify) ui.toast(result.message);
}
document.getElementById('save')!.addEventListener('click', () => save());
document.getElementById('load')!.addEventListener('click', () => {
  const result = persistence.load();
  if (result.snapshot) {
    simulation.restore(result.snapshot);
    ui.guiding = false;
    ui.render();
  }
  ui.toast(result.message);
  ui.saveStatus(result.message, !!result.snapshot);
});
document.getElementById('reset-confirm')!.addEventListener('click', () => {
  simulation.reset();
  ui.select('nova');
  world?.select('nova');
  world?.resetCamera();
  (document.getElementById('reset-dialog') as HTMLDialogElement).close();
  save(false);
  ui.toast('A fresh world is ready to explore');
});
let lastTime = performance.now(),
  renderAt = 0,
  lastDraw = lastTime,
  uiAt = 0,
  fpsAt = performance.now(),
  frames = 0;
let autosaveAt = performance.now(),
  accumulator = 0;
const modelsDialog = document.getElementById(
  'models-dialog',
) as HTMLDialogElement;
const frameInterval = 1000 / 60;
function frame(now: number) {
  requestAnimationFrame(frame);
  if (document.hidden) {
    lastTime = now;
    accumulator = 0;
    return;
  }
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  accumulator += delta;
  while (accumulator >= 0.05) {
    world?.capture(simulation.agents);
    simulation.tick(0.05);
    accumulator -= 0.05;
  }
  // Leave GPU capacity for models while their dialog covers the world.
  // Interpolate the 20 Hz simulation at up to 60 Hz. Carry scheduling remainder
  // so 90/120 Hz displays do not fall into the old uneven frame-skipping pattern.
  if (
    world?.visible &&
    !modelsDialog.open &&
    now - renderAt >= frameInterval - 0.5
  ) {
    const alpha = simulation.clock.paused ? 1 : accumulator / 0.05;
    const visualTime = Math.max(
      0,
      simulation.clock.elapsed -
        (simulation.clock.paused
          ? 0
          : (0.05 - accumulator) * simulation.clock.speed),
    );
    world.render(
      simulation.agents,
      visualTime,
      alpha,
      Math.min(0.1, (now - lastDraw) / 1000),
      simulation.clock.paused,
    );
    renderAt = now - ((now - renderAt) % frameInterval);
    lastDraw = now;
    frames++;
  }
  if (now - uiAt > 250) {
    ui.render();
    atmosphere.tick();
    tradingDesk.refreshPartner();
    uiAt = now;
  }
  if (now - fpsAt > 1500) {
    document.getElementById('fps')!.textContent =
      `${Math.round((frames * 1000) / (now - fpsAt))} FPS`;
    const stats = world?.stats;
    document.getElementById('render-detail')!.textContent = stats
      ? `${(stats.triangles / 1000).toFixed(1)}k triangles · ${stats.calls} draws`
      : '';
    frames = 0;
    fpsAt = now;
  }
  if (now - autosaveAt > 10000) {
    save(false);
    autosaveAt = now;
  }
}
requestAnimationFrame(frame);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) save(false);
  lastTime = performance.now();
  lastDraw = lastTime;
  fpsAt = lastTime;
  frames = 0;
  accumulator = 0;
});
window.addEventListener('pagehide', () => save(false));
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() =>
        ui.toast(
          'Offline cache unavailable. You can still use the local server.',
        ),
      );
  });
}
// Dismiss the HTML startup screen only once the shell and controls are ready.
window.dispatchEvent(new Event('fieldwork:ready'));
