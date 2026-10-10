import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { OpenAIPlan, readResponseStream } from '../server/openai-plan.mjs';
import { createAppServer } from '../server/index.mjs';
import { Simulation } from '../src/simulation';
import { observe } from '../src/observation';
import { ACTION_SCHEMA, parseModelAction } from '../shared/model-protocol.mjs';
const observation = () =>
  observe(new Simulation().agents[0], new Simulation().agents, 0);
const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const action = JSON.stringify({
  type: 'OBSERVE',
  x: null,
  z: null,
  seconds: null,
  poiId: null,
  message: null,
});
const sse = (events: any[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
async function fixture(t: any) {
  const dir = await mkdtemp(join(tmpdir(), 'fieldwork-plan-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let identity: any = { sub: 'user-1', email: 'tester@example.invalid' },
    tokenScope =
      'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
  let responseEvents: any[] = [
    { type: 'response.output_text.delta', delta: action },
    { type: 'response.completed', response: { status: 'completed' } },
  ];
  const requests: { url: string; init: any }[] = [];
  let models: any = { models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }] };
  const plan = new OpenAIPlan({
    dataDir: dir,
    verifyIdentity: async (_token: any, _client: any, nonce: any) => ({
      ...identity,
      nonce,
    }),
    fetchImpl: async (url: any, init: any) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('openid-configuration'))
        return json({
          issuer: 'https://auth.openai.com',
          authorization_endpoint:
            'https://auth.openai.com/api/accounts/authorize',
          token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
          jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
          revocation_endpoint: 'https://auth.openai.com/oauth/revoke',
        });
      if (String(url).endsWith('/oauth/token'))
        return json({
          access_token: 'TEST_ACCESS_NOT_REAL',
          refresh_token: 'TEST_REFRESH_NOT_REAL',
          id_token: 'TEST_ID_NOT_REAL',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: tokenScope,
        });
      if (String(url).endsWith('/models')) return json(models);
      if (String(url).endsWith('/responses')) return sse(responseEvents);
      if (String(url).endsWith('/revoke'))
        return new Response(null, { status: 200 });
      throw new Error('Unexpected fixture request');
    },
  });
  await plan.init();
  const authorize = async () => {
    const url = new URL(
      await plan.begin(
        'session-1',
        'http://127.0.0.1:4173/auth/callback',
        'new',
      ),
    );
    await plan.callback(
      new URLSearchParams({
        state: url.searchParams.get('state')!,
        code: 'TEST_CODE_NOT_REAL',
        client_id: 'oaiapp_TEST_NOT_REAL',
      }),
      'session-1',
    );
    return url;
  };
  return {
    dir,
    plan,
    requests,
    authorize,
    setIdentity: (v: any) => (identity = v),
    setScope: (v: string) => (tokenScope = v),
    setEvents: (v: any[]) => (responseEvents = v),
    setModels: (v: any) => (models = v),
  };
}
test('OAuth binds state to browser session, uses PKCE and a stable host, and consumes callbacks once', async (t) => {
  const f = await fixture(t),
    url = new URL(
      await f.plan.begin('s1', 'http://127.0.0.1:4173/auth/callback', 'new'),
    );
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('nonce'));
  assert.equal(url.searchParams.get('agent_name_hint'), 'Fieldwork');
  const params = new URLSearchParams({
    state: url.searchParams.get('state')!,
    code: 'CODE_NOT_REAL',
    client_id: 'oaiapp_TEST_NOT_REAL',
  });
  await assert.rejects(f.plan.callback(params, 'wrong-session'));
  await f.plan.callback(params, 's1');
  await assert.rejects(f.plan.callback(params, 's1'));
  const tokenRequest = f.requests.find((r) => r.url.endsWith('/oauth/token'))!;
  assert.equal(tokenRequest.init.body.get('client_id'), 'oaiapp_TEST_NOT_REAL');
  assert.ok(tokenRequest.init.body.get('code_verifier'));
  assert.equal(
    tokenRequest.init.body.get('redirect_uri'),
    'http://127.0.0.1:4173/auth/callback',
  );
  const another = new OpenAIPlan({ dataDir: f.dir });
  await another.init();
  assert.equal(another.hostId, f.plan.hostId);
  assert.equal((await stat(join(f.dir, 'accounts.json'))).mode & 0o777, 0o600);
  const returning = new URL(
    await f.plan.begin(
      's1',
      'http://127.0.0.1:4173/auth/callback',
      'oaiapp_TEST_NOT_REAL',
    ),
  );
  assert.equal(returning.searchParams.get('client_id'), 'oaiapp_TEST_NOT_REAL');
  assert.equal(returning.searchParams.has('agent_name_hint'), false);
});
test('sign-in rejects mismatched account identity, wrong client and missing plan consent', async (t) => {
  const f = await fixture(t);
  await f.authorize();
  const returnUrl = new URL(
    await f.plan.begin(
      's1',
      'http://127.0.0.1:4173/auth/callback',
      'oaiapp_TEST_NOT_REAL',
    ),
  );
  await assert.rejects(
    f.plan.callback(
      new URLSearchParams({
        state: returnUrl.searchParams.get('state')!,
        code: 'CODE',
        client_id: 'oaiapp_OTHER',
      }),
      's1',
    ),
  );
  f.setIdentity({ sub: 'different-user' });
  const otherUrl = new URL(
    await f.plan.begin(
      's1',
      'http://127.0.0.1:4173/auth/callback',
      'oaiapp_TEST_NOT_REAL',
    ),
  );
  await assert.rejects(
    f.plan.callback(
      new URLSearchParams({
        state: otherUrl.searchParams.get('state')!,
        code: 'CODE',
      }),
      's1',
    ),
  );
  f.setIdentity({ sub: 'user-1' });
  f.setScope('openid profile');
  await f.authorize();
  await assert.rejects(
    f.plan.decide(observation(), new AbortController().signal),
  );
  assert.ok(!f.requests.some((r) => r.url.endsWith('/responses')));
});
test('ID token validates signature, issuer, client audience, expiration and nonce', async (t) => {
  const f = await fixture(t),
    { publicKey, privateKey } = await generateKeyPair('RS256');
  f.plan.verifyIdentity = undefined;
  f.plan.jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: 'test' }],
  });
  const signed = async (
    claims: any = {},
    aud = 'client',
    issuer = 'https://auth.openai.com',
    expires = '1h',
  ) =>
    new SignJWT({ sub: 'user', nonce: 'nonce', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(issuer)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(privateKey);
  assert.equal(
    (await f.plan.verify(await signed(), 'client', 'nonce')).sub,
    'user',
  );
  await assert.rejects(f.plan.verify(await signed(), 'wrong-client', 'nonce'));
  await assert.rejects(f.plan.verify(await signed(), 'client', 'wrong-nonce'));
  await assert.rejects(
    f.plan.verify(
      await signed({}, 'client', 'https://wrong.example'),
      'client',
      'nonce',
    ),
  );
  await assert.rejects(
    f.plan.verify(
      await signed({}, 'client', 'https://auth.openai.com', '-1h'),
      'client',
      'nonce',
    ),
  );
  const bad = await signed();
  await assert.rejects(
    f.plan.verify(bad.slice(0, -12) + 'INVALIDTOKEN', 'client', 'nonce'),
  );
});
test('GPT decisions use exactly gpt-6.1-sol, plan SSE parameters and no paid API fallback', async (t) => {
  const f = await fixture(t);
  await f.authorize();
  const before = await f.plan.status();
  assert.equal(before.available, true);
  assert.equal(before.verified, false);
  assert.deepEqual(
    await f.plan.decide(observation(), new AbortController().signal),
    { type: 'OBSERVE' },
  );
  const request = f.requests.find((r) => r.url.endsWith('/responses'))!,
    body = JSON.parse(request.init.body);
  assert.equal(body.model, 'gpt-6.1-sol');
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.max_output_tokens, undefined);
  assert.deepEqual(body.text.format.schema, ACTION_SCHEMA);
  assert.equal(body.tools, undefined);
  assert.equal((await f.plan.status()).verified, true);
  for (let i = 0; i < 5; i++)
    await f.plan.decide(observation(), new AbortController().signal);
  await assert.rejects(
    f.plan.decide(observation(), new AbortController().signal),
  );
  assert.equal(
    f.requests.filter((r) => r.url.endsWith('/responses')).length,
    6,
  );
  const status = JSON.stringify(await f.plan.status());
  assert.ok(!status.includes('TEST_ACCESS'));
  assert.ok(!status.includes('TEST_REFRESH'));
  assert.ok(!status.includes('TEST_ID'));
});
test('model catalog mismatch and stream quota failure never claim successful GPT inference', async (t) => {
  const f = await fixture(t);
  await f.authorize();
  f.setModels({ models: [{ slug: 'other-model', visibility: 'list' }] });
  assert.equal((await f.plan.status()).available, false);
  await assert.rejects(
    f.plan.decide(observation(), new AbortController().signal),
  );
  f.plan.invalidate();
  f.setModels({ models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }] });
  f.setEvents([
    { type: 'response.output_text.delta', delta: action },
    {
      type: 'response.failed',
      response: {
        error: { code: 'subscription_sharing_usage_limit_exceeded' },
      },
    },
  ]);
  await assert.rejects(
    f.plan.decide(observation(), new AbortController().signal),
    /usage limit/,
  );
  assert.equal((await f.plan.status()).verified, false);
  f.setEvents([
    { type: 'response.output_text.delta', delta: '{"type":"RUN_SHELL"}' },
    { type: 'response.completed', response: { status: 'completed' } },
  ]);
  await assert.rejects(
    f.plan.decide(observation(), new AbortController().signal),
    /Unknown model action/,
  );
  assert.equal((await f.plan.status()).verified, false);
});
test('streams require response.completed and reject incomplete or malformed action output', async () => {
  await assert.rejects(
    readResponseStream(
      sse([{ type: 'response.output_text.delta', delta: action }]),
      new AbortController().signal,
    ),
  );
  await assert.rejects(
    readResponseStream(
      sse([{ type: 'response.incomplete' }]),
      new AbortController().signal,
    ),
  );
  assert.deepEqual(parseModelAction(action), { type: 'OBSERVE' });
  assert.throws(() => parseModelAction('{"type":"RUN_SHELL"}'));
  const bytes = new TextEncoder().encode(
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: action })}\r\n\r\ndata: ${JSON.stringify({ type: 'response.completed' })}\r\n\r\n`,
  );
  const response = new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7)
          c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    }),
  );
  assert.equal(
    await readResponseStream(response, new AbortController().signal),
    action,
  );
});
test('token refresh rotates credentials together and concurrent requests share one refresh', async (t) => {
  const f = await fixture(t);
  await f.authorize();
  f.plan.activeAccount().expiresAt = 0;
  const previous = f.requests.filter((r) =>
    r.url.endsWith('/oauth/token'),
  ).length;
  await Promise.all([f.plan.token(), f.plan.token(), f.plan.token()]);
  assert.equal(
    f.requests.filter((r) => r.url.endsWith('/oauth/token')).length,
    previous + 1,
  );
  const file = JSON.parse(await readFile(join(f.dir, 'accounts.json'), 'utf8'));
  assert.ok(file.accounts[0].expiresAt > Date.now());
  await f.plan.signOut();
  assert.equal((await f.plan.status()).connected, false);
  const signedOut = JSON.parse(
    await readFile(join(f.dir, 'accounts.json'), 'utf8'),
  );
  assert.equal(signedOut.accounts[0].accessToken, undefined);
  assert.equal(signedOut.accounts[0].refreshToken, undefined);
  assert.equal(signedOut.accounts[0].clientId, 'oaiapp_TEST_NOT_REAL');
});
test('local AI server rejects cross-origin, forged sessions and oversized/malformed observations', async (t) => {
  const f = await fixture(t);
  const server = createAppServer(f.plan, { port: 4291 });
  await new Promise<void>((r) => server.listen(4291, '127.0.0.1', r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const session = await fetch('http://127.0.0.1:4291/api/session');
  const cookie = session.headers.get('set-cookie')!.split(';')[0];
  const { csrf } = await session.json();
  assert.equal(
    (
      await fetch('http://127.0.0.1:4291/api/plan/status', {
        headers: {
          Cookie: cookie,
          'X-Fieldwork-CSRF': csrf,
          Origin: 'https://external.example',
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch('http://127.0.0.1:4291/api/plan/status', {
        headers: { Cookie: cookie, 'X-Fieldwork-CSRF': 'wrong' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch('http://127.0.0.1:4291/api/plan/decide', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-Fieldwork-CSRF': csrf,
          'Content-Type': 'application/json',
        },
        body: '{"observation":{}}',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch('http://127.0.0.1:4291/api/plan/decide', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-Fieldwork-CSRF': csrf,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ observation: observation() }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch('http://127.0.0.1:4291/api/plan/sign-in', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-Fieldwork-CSRF': csrf,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountId: 'new', extra: 'x'.repeat(17000) }),
      })
    ).status,
    413,
  );
});
