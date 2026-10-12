import { test, expect } from '@playwright/test';
import { demoCandles } from '../../src/market-data';
import { newTradingState } from '../../src/trading';
import { Simulation } from '../../src/simulation';
const key = 'aurelius.trading.v1';
async function desk(page: any, isMobile: boolean) {
  if (isMobile) await page.locator('[data-tab="desk"]').click();
  else await page.locator('#research-desk').scrollIntoViewIfNeeded();
}
test('office identity, local weather, synthetic backtest, ledger export and saved results', async ({
  page,
  context,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 14.6, longitude: 120.98 });
  await page.route('https://api.open-meteo.com/**', (r) =>
    r.fulfill({ json: { current: { weather_code: 61, temperature_2m: 27 } } }),
  );
  await page.goto('/');
  await expect(page).toHaveTitle(/AURELIUS/);
  await expect(page.locator('.world-heading h2')).toContainText(
    'The trading floor',
  );
  await expect(page.locator('#local-time')).toContainText(/session|hour/);
  await page.locator('#weather-connect').click();
  await expect(page.locator('#weather-status')).toContainText('Rain · 27°C');
  await desk(page, isMobile);
  await page.locator('#demo-candles').click();
  await expect(page.locator('#data-status')).toContainText('SYNTHETIC');
  await page.locator('#run-backtest').click();
  await expect(page.locator('#test-status')).toContainText(
    'Evaluation complete',
  );
  await expect(page.locator('#ledger-count')).toContainText('61 CLOSED TRADES');
  await expect(page.locator('#evidence-status')).toContainText(
    'do not establish a trading edge',
  );
  const before = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)!),
    key,
  );
  expect(before.completed).toBe(true);
  expect(before.accounts.every((a: any) => a.position === null)).toBe(true);
  const download = page.waitForEvent('download');
  await page.locator('#export-trades').click();
  expect((await download).suggestedFilename()).toContain('ledger.csv');
  await page.reload();
  await desk(page, isMobile);
  await expect(page.locator('#ledger-count')).toContainText('61 CLOSED TRADES');
  const after = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)!),
    key,
  );
  expect(after.accounts).toEqual(before.accounts);
  await expect(page.locator('.tradingview-card')).toContainText(
    'cannot reproduce AI decisions',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test('CSV rejects invalid input, imports genuine-format candles, and unavailable public feed is explicit', async ({
  page,
  isMobile,
}) => {
  await page.route('https://data-api.binance.vision/**', (r) =>
    r.fulfill({ status: 503, body: 'Unavailable' }),
  );
  await page.goto('/');
  await desk(page, isMobile);
  await page.locator('#fetch-candles').click();
  await expect(page.locator('#test-status')).toContainText(
    'Import an OHLC CSV',
  );
  await page.locator('#import-candles').setInputFiles({
    name: 'bad.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('x,y\n1,2'),
  });
  await expect(page.locator('#test-status')).toContainText('CSV needs');
  const candles = demoCandles().slice(0, 100);
  const csv =
    'time,open,high,low,close,volume\n' +
    candles
      .map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume].join(','))
      .join('\n');
  await page.locator('#market-symbol').fill('NASDAQ:AAPL');
  await page.locator('#import-candles').setInputFiles({
    name: 'aapl.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.locator('#data-status')).toContainText('100 bars');
  await expect(page.locator('#tradingview-link')).toHaveAttribute(
    'href',
    /NASDAQ%3AAAPL/,
  );
  await page.locator('#trading-mode').selectOption('models');
  await page.locator('#run-backtest').click();
  await expect(page.locator('#test-status')).toContainText(
    'Assign a real model',
  );
});
test('model route receives only past bars and cancellation drops late decisions', async ({
  page,
  isMobile,
}) => {
  let sawTrading = false;
  let pending: ((value: unknown) => void) | undefined;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session')
      return route.fulfill({ json: { csrf: 'TEST_ONLY' } });
    if (path.endsWith('/status'))
      return route.fulfill({
        json: {
          connected: true,
          available: true,
          verified: false,
          model: 'gpt-6.1-sol',
          message: 'Test account',
          active: 'test',
          accounts: [{ id: 'test', label: 'Test' }],
        },
      });
    if (path.endsWith('/decide')) {
      const o = route.request().postDataJSON().observation;
      if (!o.trading)
        return route.fulfill({
          json: { action: { type: 'WAIT', seconds: 15 } },
        });
      sawTrading = true;
      expect(o.trading.bars.length).toBe(50);
      expect(o.trading.bars.at(-1).time).toBe(demoCandles()[419].time);
      expect(
        o.trading.bars.some((b: any) => b.time >= demoCandles()[420].time),
      ).toBe(false);
      await new Promise((resolve) => {
        pending = resolve;
      });
      try {
        await route.fulfill({
          json: {
            action: {
              type: 'TRADE',
              side: 'LONG',
              message: 'Synthetic test thesis',
            },
          },
        });
      } catch {}
      return;
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await page.locator('#models').click();
  await expect(page.locator('#plan-status')).toContainText('Test account');
  await page.locator('[data-model-agent="nova"]').selectOption('gpt61');
  await page.locator('#assign-models').click();
  await page.locator('#models-close').click();
  await desk(page, isMobile);
  await page.locator('#demo-candles').click();
  await page.locator('#trading-mode').selectOption('models');
  await page.locator('#run-backtest').click();
  await expect.poll(() => sawTrading).toBe(true);
  await page.locator('#pause-backtest').click();
  pending?.(null);
  await page.waitForTimeout(250);
  const s = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)!),
    key,
  );
  expect(s.cursor).toBe(s.start);
  expect(
    s.accounts.every((a: any) => a.position === null && a.trades.length === 0),
  ).toBe(true);
});
test('eliminated accounts remain dead on reload and disappear from the active floor', async ({
  page,
  isMobile,
}) => {
  const s = newTradingState(demoCandles(), 'Synthetic test', 'DEMO');
  s.accounts[0].balance = 7900;
  s.accounts[0].equity = 7900;
  s.accounts[0].dead = true;
  s.accounts[0].note = 'ELIMINATED';
  await page.addInitScript(
    ({ key, s }) => localStorage.setItem(key, JSON.stringify(s)),
    { key, s },
  );
  await page.goto('/');
  await expect(page.locator('#active-partners')).toHaveText('02 / 03');
  await expect(
    page.locator('.agent-label').filter({ hasText: 'Nova' }),
  ).toBeHidden();
  if (isMobile) await page.locator('[data-tab="agents"]').click();
  await expect(page.locator('#selected-state')).toHaveText('eliminated');
  await expect(page.locator('#move')).toBeDisabled();
  await desk(page, isMobile);
  await expect(page.locator('.account-card.eliminated')).toHaveCount(1);
});

test('valid model actions execute with provenance and provider errors hold without baseline substitution', async ({
  page,
  isMobile,
}) => {
  const state = newTradingState(
    demoCandles(),
    'Synthetic test',
    'DEMO',
    'holdout',
    'models',
  );
  state.cursor = 599;
  const snapshot = new Simulation().snapshot();
  snapshot.paused = true;
  snapshot.providers = { nova: 'gpt61', atlas: 'gpt61' };
  await page.addInitScript(
    ({ state, snapshot }) => {
      localStorage.setItem('aurelius.trading.v1', JSON.stringify(state));
      localStorage.setItem('aurelius.office.v1', JSON.stringify(snapshot));
    },
    { state, snapshot },
  );
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session')
      return route.fulfill({ json: { csrf: 'TEST_ONLY' } });
    if (path.endsWith('/decide')) {
      const observation = route.request().postDataJSON().observation;
      expect(observation.trading).toBeDefined();
      if (observation.agentId === 'atlas')
        return route.fulfill({
          status: 429,
          json: { error: 'Synthetic quota failure' },
        });
      return route.fulfill({
        json: {
          action: {
            type: 'TRADE',
            side: 'LONG',
            message: 'Synthetic model thesis',
          },
        },
      });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await desk(page, isMobile);
  await page.locator('#run-backtest').click();
  await expect(page.locator('#test-status')).toContainText(
    'Evaluation complete',
  );
  const result = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('aurelius.trading.v1')!),
  );
  expect(result.accounts[0].trades.length).toBe(1);
  expect(result.accounts[0].trades[0].source).toContain('GPT');
  expect(result.accounts[1].trades.length).toBe(0);
  expect(result.accounts[1].note).toContain('quota failure');
  expect(result.accounts[2].trades.length).toBe(0);
  expect(result.accounts[2].note).toContain('No model assigned');
});
