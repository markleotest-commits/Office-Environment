import { test, expect } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
const storageKey = 'fieldwork.world.v1';
async function panel(page: any, name: string, mobile: boolean) {
  if (mobile) await page.locator(`button[data-tab="${name}"]`).click();
}
test('render, selection, movement, controls, storage, and offline reload', async ({
  page,
  context,
  isMobile,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expect(page.locator('#world-error')).toBeHidden();
  await expect(page.locator('.agent-label')).toHaveCount(3);
  await expect(page.locator('#fps')).toContainText('FPS');
  await expect
    .poll(async () => page.locator('#render-detail').textContent())
    .toContain('triangles');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-world.png`,
  });
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click();
  const pausedTime = await page.locator('#clock').textContent();
  await page.waitForTimeout(1100);
  await expect(page.locator('#clock')).toHaveText(pausedTime!);
  await panel(page, 'agents', isMobile);
  await page.locator('[data-agent="echo"]').click();
  await expect(page.locator('#selected-name')).toHaveText('Echo');
  await page.locator('#say').click();
  await expect(page.locator('#selected-state')).toHaveText('talking');
  await panel(page, 'world', isMobile);
  await page.locator('#save').click();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    storageKey,
  );
  expect(saved.paused).toBe(true);
  expect(saved.agents[2].memory.length).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('#simulation-label')).toHaveText('World is paused');
  await panel(page, 'agents', isMobile);
  await page.locator('[data-agent="echo"]').click();
  await expect(page.locator('#selected-state')).toHaveText('talking');
  await page.locator('#move').click();
  await panel(page, 'world', isMobile);
  // Touch gestures go through real Chromium input, including multitouch pinch/pan.
  if (isMobile) {
    const cdp = await context.newCDPSession(page);
    const bounds = await page.locator('#viewport canvas').boundingBox();
    const x = bounds!.x + bounds!.width / 2,
      y = bounds!.y + bounds!.height * 0.55;
    const beforeGesture = await page
      .locator('.agent-label')
      .first()
      .getAttribute('style');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 30, y },
        { x: x + 30, y },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: x - 65, y: y + 10 },
        { x: x + 65, y: y + 10 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect
      .poll(async () =>
        page.locator('.agent-label').first().getAttribute('style'),
      )
      .not.toBe(beforeGesture);
    await page.locator('#camera-reset').click();
  }
  await page.locator('#zoom-in').click();
  await page.locator('#zoom-out').click();
  await page.locator('#camera-reset').click();
  const canvasBounds = await page.locator('#viewport canvas').boundingBox();
  const camera = new PerspectiveCamera(
    42,
    canvasBounds!.width / canvasBounds!.height,
    0.1,
    150,
  );
  camera.position.set(33, 35, 43);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const destination = new Vector3(0, 0, 10).project(camera);
  await page.locator('#viewport canvas').click({
    position: {
      x: (destination.x * 0.5 + 0.5) * canvasBounds!.width,
      y: (-destination.y * 0.5 + 0.5) * canvasBounds!.height,
    },
  });
  await expect(page.locator('#toast')).toContainText('A new destination');
  await page.locator('#save').click();
  const guided = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    storageKey,
  );
  expect(guided.agents[2].state).toBe('moving');
  expect(guided.agents[2].path.length).toBeGreaterThan(0);
  const target = guided.agents[2].path.at(-1);
  expect(Math.hypot(target.x, target.z - 10)).toBeLessThan(0.3);
  const before = saved.agents.map((a: any) => a.position);
  await page.locator('[data-speed="4"]').click();
  await page
    .getByRole('button', { name: 'Resume simulation', exact: true })
    .click();
  await page.waitForTimeout(4500);
  await page.locator('#save').click();
  const after = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    storageKey,
  );
  expect(
    after.agents.some(
      (a: any, i: number) =>
        Math.hypot(a.position.x - before[i].x, a.position.z - before[i].z) >
        0.5,
    ),
  ).toBeTruthy();
  await panel(page, 'journal', isMobile);
  await expect(page.locator('#event-list li').first()).toBeVisible();
  await page.locator('[data-filter="message"]').click();
  await expect(page.locator('#event-list')).toContainText('Hello, neighbors!');
  await panel(page, 'world', isMobile);
  await page.locator('#reset').click();
  await page.locator('#reset-confirm').click();
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click();
  await page.locator('#save').click();
  const reset = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    storageKey,
  );
  expect(reset.interactions).toEqual({});
  expect(reset.elapsed).toBeLessThan(2);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expect(page.locator('#world-error')).toBeHidden();
  expect(errors).toEqual([]);
  expect(
    requests.every((url) => new URL(url).hostname === '127.0.0.1'),
  ).toBeTruthy();
});
test('corrupt saves recover and blocked storage is reported', async ({
  page,
  isMobile,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, '{bad json'),
    storageKey,
  );
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('Starting fresh');
  await expect(page.locator('#world-error')).toBeHidden();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Blocked');
    };
  });
  await panel(page, 'world', isMobile);
  await page.locator('#save').click();
  await expect(page.locator('#save-status')).toContainText(
    'Storage unavailable',
  );
});

test('model picker routes GPT decisions through the local plan bridge and labels quota fallbacks', async ({
  page,
  isMobile,
}) => {
  let decisions = 0,
    fail = false;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let response: any;
    if (url.pathname === '/api/session')
      response = { csrf: 'TEST_CSRF_NOT_REAL' };
    else if (url.pathname.endsWith('/status'))
      response = {
        connected: true,
        available: true,
        verified: decisions > 0,
        model: 'gpt-6.1-sol',
        message: 'Using ChatGPT plan (test bridge)',
        active: 'test-account',
        accounts: [{ id: 'test-account', label: 'Test account' }],
      };
    else if (url.pathname.endsWith('/decide')) {
      const data = route.request().postDataJSON();
      expect(data.observation.agentId).toBe('nova');
      decisions++;
      if (fail) {
        await route.fulfill({
          status: 429,
          json: { error: 'ChatGPT usage limit reached. Open Manage usage.' },
        });
        return;
      }
      response = { action: { type: 'OBSERVE' } };
    } else response = { ok: true };
    await route.fulfill({ json: response });
  });
  await page.goto('/');
  await page.locator('[data-speed="4"]').click();
  await page.getByRole('button', { name: 'Configure AI models' }).click();
  await expect(page.locator('#plan-status')).toContainText(
    'Using ChatGPT plan',
  );
  await page.getByLabel('Model for Nova').selectOption('gpt61');
  await page.locator('#assign-models').click();
  await page.locator('#models-close').click();
  await expect.poll(() => decisions, { timeout: 15000 }).toBeGreaterThan(0);
  await panel(page, 'agents', isMobile);
  await expect(page.locator('#provider-status')).toContainText(
    'Last source: GPT‑6.1‑sol',
  );
  await expect(page.locator('#provider-status')).toContainText(
    /[1-6] model decisions/,
  );
  fail = true;
  await expect(page.locator('#provider-status')).toContainText(
    'Last source: Local rules',
    { timeout: 15000 },
  );
  await expect(page.locator('#provider-status')).toContainText(
    'ChatGPT usage limit',
  );
  await panel(page, 'world', isMobile);
  await page.locator('#save').click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('fieldwork.world.v1')!).providers.nova,
    ),
  ).toBe('gpt61');
});

test('model settings prevent unavailable GPT or unloaded local models from being assigned', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure AI models' }).click();
  await expect(page.locator('#plan-status')).toContainText(
    'Start the AI server',
  );
  await page.getByLabel('Model for Nova').selectOption('gpt61');
  await expect(page.locator('#assign-models')).toBeDisabled();
  await page.getByLabel('Model for Nova').selectOption('qwen');
  await expect(page.locator('#assign-models')).toBeDisabled();
  await page.getByLabel('Model for Nova').selectOption('rules');
  await expect(page.locator('#assign-models')).toBeEnabled();
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'gpu', {
      value: undefined,
      configurable: true,
    }),
  );
  await page.locator('#load-qwen').click();
  await expect(page.locator('#qwen-status')).toContainText(
    'does not provide WebGPU',
  );
});
