// Optional live smoke test. Downloads a free model; never signs in or calls GPT.
import { chromium } from '@playwright/test';
const origin = process.env.FIELDWORK_SMOKE_ORIGIN ?? 'http://127.0.0.1:4173';
const model = process.env.FIELDWORK_SMOKE_MODEL ?? 'smollm';
if (
  !['smollm', 'qwen'].includes(model) ||
  new URL(origin).hostname !== '127.0.0.1'
)
  throw new Error('Use a local Fieldwork server and qwen or smollm.');
const proxy = process.env.FIELDWORK_SMOKE_PROXY;
const browser = await chromium.launch({
  args: [
    '--enable-unsafe-webgpu',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  ...(proxy ? { proxy: { server: proxy } } : {}),
});
try {
  const context = await browser.newContext({
    viewport: { width: 600, height: 800 },
  });
  context.setDefaultTimeout(30000);
  if (proxy) {
    // Local app traffic stays on loopback; model downloads use the configured proxy.
    await context.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const response = await fetch(request.url(), {
        method: request.method(),
        headers: request.headers(),
        body: request.postData() ?? undefined,
      });
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
  }
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByRole('button', { name: 'Configure AI models' }).click();
  await page.locator(`#load-${model}`).click();
  let ready = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(15000);
    const text = await page.locator(`#${model}-status`).textContent();
    console.log(`${model}: ${text}`);
    if (text.startsWith('Ready')) {
      ready = true;
      break;
    }
    if (/could not|does not|No compatible|too long|failed/i.test(text))
      throw new Error(text);
  }
  if (!ready)
    throw new Error('The model did not finish loading within five minutes.');
  await page.getByLabel('Model for Nova').selectOption(model);
  await page.locator('#assign-models').click();
  // Keep settings open so software WebGPU can work without 3D draws.
  let confirmed = false;
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(15000);
    const source = await page.locator('#provider-status').textContent();
    console.log(`Decision status: ${source}`);
    if (
      /Last source: (SmolLM2|Qwen2.5)/.test(source) &&
      /[1-9]\d* model decisions/.test(source)
    ) {
      confirmed = true;
      break;
    }
    const status = await page.locator(`#${model}-status`).textContent();
    if (/cancelled|failed/i.test(status)) throw new Error(status);
  }
  if (!confirmed)
    throw new Error(
      'No validated model decision within two minutes. Review the reported fallback reason.',
    );
  await page.locator('#models-close').click();
  console.log(
    'Live model decision confirmed:',
    await page.locator('#provider-status').textContent(),
  );
} finally {
  await browser.close();
}
