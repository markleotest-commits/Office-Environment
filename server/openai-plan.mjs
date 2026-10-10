import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  ACTION_SCHEMA,
  MODEL_INSTRUCTIONS,
  compactObservation,
  parseModelAction,
} from '../shared/model-protocol.mjs';
const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
export const GPT_MODEL = 'gpt-6.1-sol';
const SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random = () => randomBytes(32).toString('base64url');
export class PlanError extends Error {
  constructor(message, status = 400, code = 'plan_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export class OpenAIPlan {
  constructor({ dataDir, fetchImpl = fetch, verifyIdentity } = {}) {
    this.dataDir = dataDir;
    this.fetch = fetchImpl;
    this.verifyIdentity = verifyIdentity;
    this.accounts = [];
    this.active = null;
    this.attempts = new Map();
    this.refreshes = new Map();
    this.catalog = null;
    this.catalogAt = 0;
    this.calls = [];
    this.busy = false;
    this.verified = false;
  }
  async init() {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await chmod(this.dataDir, 0o700);
    this.file = join(this.dataDir, 'accounts.json');
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (
        !saved.hostId?.startsWith('urn:uuid:') ||
        !Array.isArray(saved.accounts)
      )
        throw new Error('Invalid connection file');
      this.hostId = saved.hostId;
      this.accounts = saved.accounts;
      this.active = saved.active ?? null;
      await chmod(this.file, 0o600);
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new PlanError(
          'Local connection file could not be read. Restore it or move it aside before restarting.',
          500,
        );
      this.hostId = `urn:uuid:${randomUUID()}`;
      await this.persist();
    }
  }
  async persist() {
    // One write queue also prevents concurrent account switches from losing updates.
    const body = JSON.stringify({
      hostId: this.hostId,
      accounts: this.accounts,
      active: this.active,
    });
    this.writing = (this.writing ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const temp = join(this.dataDir, `accounts-${random()}.tmp`);
        await writeFile(temp, body, { mode: 0o600 });
        await rename(temp, this.file);
        await chmod(this.file, 0o600);
      });
    await this.writing;
  }
  async discovery() {
    if (this.discoveryData) return this.discoveryData;
    const res = await this.fetch(`${ISSUER}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok)
      throw new PlanError(
        'OpenAI sign-in is unavailable. Try again later.',
        503,
      );
    const d = await res.json();
    if (
      d.issuer !== ISSUER ||
      !['authorization_endpoint', 'token_endpoint', 'jwks_uri'].every(
        (k) => typeof d[k] === 'string' && new URL(d[k]).origin === ISSUER,
      )
    )
      throw new PlanError('Unexpected OpenAI sign-in configuration.', 502);
    this.discoveryData = d;
    return d;
  }
  activeAccount() {
    return this.accounts.find((a) => a.clientId === this.active);
  }
  async begin(sessionId, callback, accountId) {
    const d = await this.discovery();
    let account;
    if (accountId && accountId !== 'new') {
      account = this.accounts.find((a) => a.clientId === accountId);
      if (!account) throw new PlanError('Unknown saved account.');
    }
    for (const [key, a] of this.attempts)
      if (a.expiresAt < Date.now() || a.sessionId === sessionId)
        this.attempts.delete(key);
    if (this.attempts.size > 16)
      throw new PlanError('Too many pending sign-ins.', 429);
    const state = random(),
      nonce = random(),
      verifier = random();
    this.attempts.set(state, {
      sessionId,
      callback,
      nonce,
      verifier,
      account,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    const url = new URL(d.authorization_endpoint);
    const parameters = {
      client_id: account?.clientId ?? 'dynamic_agent_client',
      ext_agent_host_id: this.hostId,
      response_type: 'code',
      redirect_uri: callback,
      scope: SCOPES,
      resource: RESOURCE,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    };
    if (!account) parameters.agent_name_hint = 'Fieldwork';
    // Hints remain in protected storage; omit them to avoid exposing ID tokens to the app UI.
    Object.entries(parameters).forEach(([k, v]) => url.searchParams.set(k, v));
    return url.href;
  }
  async exchange(form) {
    const d = await this.discovery();
    const res = await this.fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok)
      throw new PlanError(
        'ChatGPT authorization expired or was rejected. Sign in again.',
        401,
        'sign_in_required',
      );
    const token = await res.json();
    if (
      typeof token.access_token !== 'string' ||
      token.token_type?.toLowerCase() !== 'bearer' ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in <= 0
    )
      throw new PlanError('Invalid sign-in response.', 502);
    return token;
  }
  async verify(token, clientId, nonce) {
    if (this.verifyIdentity) return this.verifyIdentity(token, clientId, nonce);
    const d = await this.discovery();
    this.jwks ??= createRemoteJWKSet(new URL(d.jwks_uri));
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: d.issuer,
      audience: clientId,
      requiredClaims: ['sub', 'exp', 'iat'],
      clockTolerance: 5,
    });
    if (!payload.sub || (nonce !== undefined && payload.nonce !== nonce))
      throw new PlanError('Sign-in identity could not be verified.', 401);
    return payload;
  }
  async callback(params, sessionId) {
    const state = params.get('state');
    const attempt = this.attempts.get(state);
    if (
      !attempt ||
      attempt.sessionId !== sessionId ||
      attempt.expiresAt < Date.now()
    )
      throw new PlanError(
        'Sign-in session expired or did not match. Start again.',
        401,
      );
    this.attempts.delete(state);
    if (params.has('error'))
      throw new PlanError(
        'ChatGPT sign-in was declined. No connection was made.',
        401,
      );
    const supplied = params.get('client_id');
    const clientId = attempt.account?.clientId ?? supplied;
    if (
      !clientId ||
      clientId === 'dynamic_agent_client' ||
      (attempt.account && supplied && supplied !== clientId)
    )
      throw new PlanError('Sign-in registration did not match.', 401);
    const code = params.get('code');
    if (!code) throw new PlanError('Authorization code is missing.', 401);
    const token = await this.exchange({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: attempt.verifier,
      redirect_uri: attempt.callback,
      resource: RESOURCE,
    });
    const identity = await this.verify(token.id_token, clientId, attempt.nonce);
    if (attempt.account && attempt.account.subject !== identity.sub)
      throw new PlanError(
        'Selected account did not match. Add a different account instead.',
        401,
      );
    const scopes =
      typeof token.scope === 'string' ? token.scope.split(' ') : [];
    const account = {
      clientId,
      subject: identity.sub,
      email:
        typeof identity.email === 'string' ? identity.email : 'ChatGPT account',
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      idToken: token.id_token,
      scopes,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
    const index = this.accounts.findIndex((a) => a.clientId === clientId);
    if (index >= 0 && this.accounts[index].subject !== identity.sub)
      throw new PlanError('Registered account identity did not match.', 401);
    if (index >= 0) this.accounts[index] = account;
    else this.accounts.push(account);
    this.active = clientId;
    this.invalidate();
    await this.persist();
    return scopes.includes('chatgpt.tokens.use.direct');
  }
  invalidate() {
    this.revision = (this.revision ?? 0) + 1;
    this.catalog = null;
    this.catalogAt = 0;
    this.verified = false;
  }
  async token() {
    const account = this.activeAccount();
    const revision = this.revision;
    if (
      !account?.accessToken ||
      !account.scopes.includes('chatgpt.tokens.use.direct')
    )
      throw new PlanError(
        'Continue with ChatGPT and allow plan usage first.',
        401,
        'sign_in_required',
      );
    if (account.expiresAt > Date.now() + 60000) return account.accessToken;
    if (!account.refreshToken)
      throw new PlanError(
        'ChatGPT connection expired. Sign in again.',
        401,
        'sign_in_required',
      );
    if (!this.refreshes.has(account.clientId)) {
      const pending = (async () => {
        const token = await this.exchange({
          grant_type: 'refresh_token',
          client_id: account.clientId,
          refresh_token: account.refreshToken,
          resource: RESOURCE,
        });
        if (token.id_token) {
          const identity = await this.verify(token.id_token, account.clientId);
          if (identity.sub !== account.subject)
            throw new PlanError('Refreshed identity did not match.', 401);
        }
        const scopes = token.scope ? token.scope.split(' ') : account.scopes;
        if (!scopes.includes('chatgpt.tokens.use.direct'))
          throw new PlanError(
            'ChatGPT plan usage is no longer authorized.',
            401,
          );
        if (revision !== this.revision)
          throw new PlanError('Connection changed during token renewal.', 409);
        Object.assign(account, {
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? account.refreshToken,
          idToken: token.id_token ?? account.idToken,
          expiresAt: Date.now() + token.expires_in * 1000,
          scopes,
        });
        await this.persist();
        return account.accessToken;
      })().finally(() => this.refreshes.delete(account.clientId));
      this.refreshes.set(account.clientId, pending);
    }
    return this.refreshes.get(account.clientId);
  }
  async models() {
    if (this.catalog && Date.now() - this.catalogAt < 60000)
      return this.catalog;
    const account = this.activeAccount(),
      revision = this.revision;
    const token = await this.token();
    const res = await this.fetch(`${RESOURCE}/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok)
      throw new PlanError(
        'Could not verify models available to your ChatGPT account.',
        res.status === 401 ? 401 : 503,
      );
    const body = await res.json();
    if (!Array.isArray(body.models))
      throw new PlanError('Unexpected ChatGPT model catalog.', 502);
    if (account !== this.activeAccount() || revision !== this.revision)
      throw new PlanError('Account changed while checking models.', 409);
    this.catalog = body.models
      .filter((m) => m.visibility === 'list')
      .map((m) => m.slug)
      .filter((s) => typeof s === 'string');
    this.catalogAt = Date.now();
    return this.catalog;
  }
  async status() {
    const a = this.activeAccount();
    let available = false,
      message = 'Continue with ChatGPT to use your included plan allowance.';
    if (a?.accessToken) {
      try {
        available = (await this.models()).includes(GPT_MODEL);
        message = available
          ? 'Using ChatGPT plan. Access is confirmed when a model decision completes.'
          : 'GPT-6.1-sol is not listed for this account. No substitute model is selected.';
      } catch (error) {
        message =
          error instanceof PlanError
            ? error.message
            : 'ChatGPT connection could not be checked. Try again.';
      }
    }
    return {
      connected:
        !!a?.accessToken && a.scopes.includes('chatgpt.tokens.use.direct'),
      available,
      verified: this.verified,
      model: GPT_MODEL,
      message,
      active: this.active,
      accounts: this.accounts.map((a, i) => ({
        id: a.clientId,
        label: `${a.email} · account ${i + 1}`,
      })),
    };
  }
  async select(id) {
    if (!this.accounts.some((a) => a.clientId === id))
      throw new PlanError('Unknown account.');
    this.active = id;
    this.invalidate();
    await this.persist();
  }
  async signOut() {
    const a = this.activeAccount();
    let revoked = !a?.refreshToken;
    if (a?.refreshToken) {
      try {
        const d = await this.discovery();
        if (
          !d.revocation_endpoint ||
          new URL(d.revocation_endpoint).origin !== ISSUER
        )
          throw new Error('No revocation endpoint');
        const response = await this.fetch(d.revocation_endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: a.refreshToken,
            token_type_hint: 'refresh_token',
            client_id: a.clientId,
          }),
          signal: AbortSignal.timeout(10000),
        });
        revoked = response.status === 200;
      } catch {
        revoked = false;
      }
    }
    if (a) {
      delete a.accessToken;
      delete a.refreshToken;
      delete a.idToken;
      a.scopes = [];
    }
    this.invalidate();
    await this.persist();
    return {
      message: revoked
        ? 'Signed out. Your saved account registration is retained.'
        : 'Signed out locally; remote revocation was not confirmed. Disconnect Fieldwork in ChatGPT settings.',
    };
  }
  async decide(observation, signal) {
    if (this.busy)
      throw new PlanError(
        'GPT is already deciding for an agent. Try the next decision.',
        429,
        'busy',
      );
    this.calls = this.calls.filter((t) => Date.now() - t < 60000);
    if (this.calls.length >= 6)
      throw new PlanError(
        'Local limit reached: 6 GPT decisions per minute.',
        429,
        'local_limit',
      );
    const account = this.activeAccount();
    this.busy = true;
    try {
      if (!(await this.models()).includes(GPT_MODEL))
        throw new PlanError(
          'GPT-6.1-sol is unavailable for this account.',
          403,
          'model_unavailable',
        );
      const token = await this.token();
      if (account !== this.activeAccount() || !account?.accessToken)
        throw new PlanError('Account changed before the decision.', 409);
      this.calls.push(Date.now());
      const res = await this.fetch(`${RESOURCE}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal,
        body: JSON.stringify({
          model: GPT_MODEL,
          store: false,
          stream: true,
          reasoning: { effort: 'low' },
          instructions: MODEL_INSTRUCTIONS,
          input: [
            {
              role: 'user',
              content: JSON.stringify(compactObservation(observation)),
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'world_action',
              strict: true,
              schema: ACTION_SCHEMA,
            },
          },
        }),
      });
      if (!res.ok) {
        if (res.status === 429)
          throw new PlanError(
            'ChatGPT usage limit reached. Review Manage usage and wait for your allowance to reset.',
            429,
            'usage_limit',
          );
        throw new PlanError(
          'ChatGPT could not make this decision. Check your account connection.',
          res.status === 401 ? 401 : 502,
        );
      }
      const result = await readResponseStream(res, signal);
      if (account !== this.activeAccount() || !account?.accessToken)
        throw new PlanError('Account changed during the decision.', 409);
      const action = parseModelAction(result);
      this.verified = true;
      return action;
    } finally {
      this.busy = false;
    }
  }
}
export async function readResponseStream(response, signal) {
  if (!response.body) throw new PlanError('Empty model stream.', 502);
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    output = '',
    complete = false,
    total = 0;
  const event = (block) => {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (!data || data === '[DONE]') return;
    const e = JSON.parse(data);
    if (e.type === 'response.output_text.delta') output += e.delta;
    if (e.type === 'response.failed' || e.type === 'error') {
      const code = e.response?.error?.code ?? e.code;
      if (code === 'subscription_sharing_usage_limit_exceeded')
        throw new PlanError(
          'ChatGPT usage limit reached. Open Manage usage.',
          429,
          'usage_limit',
        );
      if (code === 'subscription_sharing_usage_unavailable')
        throw new PlanError(
          'ChatGPT usage could not be checked. Try later.',
          503,
          'usage_unavailable',
        );
      throw new PlanError(
        'ChatGPT decision failed. Local rules will be used.',
        502,
      );
    }
    if (e.type === 'response.incomplete')
      throw new PlanError('ChatGPT decision was incomplete.', 502);
    if (e.type === 'response.completed') {
      complete = true;
      if (!output)
        output = (e.response?.output ?? [])
          .flatMap((i) => i.content ?? [])
          .filter((c) => c.type === 'output_text')
          .map((c) => c.text)
          .join('');
    }
    if (output.length > 4000)
      throw new PlanError('Model action is too large.', 502);
  };
  try {
    while (true) {
      if (signal?.aborted) throw new PlanError('Decision cancelled.', 499);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 256000)
        throw new PlanError('Model stream exceeded its size limit.', 502);
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(
        /\r\n/g,
        '\n',
      );
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        event(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) event(buffer);
    if (!complete)
      throw new PlanError('Model stream ended before completion.', 502);
    return output;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
