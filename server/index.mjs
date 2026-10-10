import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, join, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OpenAIPlan, PlanError } from './openai-plan.mjs';
const random = () => randomBytes(32).toString('base64url');
const equal = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function validObservation(o) {
  const num = (n) => typeof n === 'number' && Number.isFinite(n);
  const pos = (p) => p && num(p.x) && num(p.z) && Math.hypot(p.x, p.z) <= 23;
  const str = (s, max) => typeof s === 'string' && s.length <= max;
  return (
    o &&
    ['nova', 'atlas', 'echo'].includes(o.agentId) &&
    str(o.name, 40) &&
    str(o.role, 40) &&
    pos(o.position) &&
    num(o.energy) &&
    o.energy >= 0 &&
    o.energy <= 100 &&
    num(o.time) &&
    o.time >= 0 &&
    Array.isArray(o.nearbyAgents) &&
    o.nearbyAgents.length <= 2 &&
    o.nearbyAgents.every(
      (a) => a && str(a.id, 40) && str(a.name, 40) && pos(a.position),
    ) &&
    Array.isArray(o.pointsOfInterest) &&
    o.pointsOfInterest.length <= 5 &&
    o.pointsOfInterest.every(
      (p) =>
        p &&
        str(p.id, 40) &&
        str(p.name, 60) &&
        str(p.activity, 120) &&
        pos(p.position),
    ) &&
    Array.isArray(o.memory) &&
    o.memory.length <= 12 &&
    o.memory.every((m) => m && num(m.time) && str(m.text, 160)) &&
    o.visits &&
    typeof o.visits === 'object' &&
    !Array.isArray(o.visits) &&
    Object.entries(o.visits).length <= 5 &&
    Object.entries(o.visits).every(([k, v]) => str(k, 40) && num(v) && v >= 0)
  );
}
export function createAppServer(
  plan,
  { root = resolve('dist'), port = 4173 } = {},
) {
  const origin = `http://127.0.0.1:${port}`;
  const sessions = new Map();
  const json = (res, status, body) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
  };
  const session = (req) => {
    const id = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('fieldwork_session='))
      ?.slice(18);
    const value = sessions.get(id);
    return value && value.expiresAt > Date.now() ? { id, ...value } : null;
  };
  const body = async (req) => {
    let value = '';
    for await (const chunk of req) {
      value += chunk;
      if (Buffer.byteLength(value) > 16384)
        throw new PlanError('Request is too large.', 413);
    }
    try {
      return JSON.parse(value);
    } catch {
      throw new PlanError('Invalid request JSON.');
    }
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.headers.host !== `127.0.0.1:${port}`) {
      json(res, 403, {
        error: 'Use this server through its 127.0.0.1 loopback URL.',
      });
      return;
    }
    if (req.headers.origin && req.headers.origin !== origin) {
      json(res, 403, { error: 'Cross-origin requests are disabled.' });
      return;
    }
    const url = new URL(req.url, origin);
    try {
      if (url.pathname === '/api/session' && req.method === 'GET') {
        for (const [id, s] of sessions)
          if (s.expiresAt < Date.now()) sessions.delete(id);
        let current = session(req);
        if (!current) {
          if (sessions.size > 100)
            throw new PlanError('Too many browser sessions.', 429);
          const id = random(),
            csrf = random();
          current = { id, csrf, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
          sessions.set(id, current);
          res.setHeader(
            'Set-Cookie',
            `fieldwork_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
          );
        }
        json(res, 200, { csrf: current.csrf });
        return;
      }
      if (url.pathname === '/auth/callback' && req.method === 'GET') {
        const s = session(req);
        if (!s)
          throw new PlanError(
            'Sign-in browser session is missing. Start from the Fieldwork app.',
            401,
          );
        await plan.callback(url.searchParams, s.id);
        res
          .writeHead(303, {
            Location: '/?chatgpt=connected',
            'Cache-Control': 'no-store',
          })
          .end();
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const s = session(req);
        if (!s)
          throw new PlanError('Reload the app to start a local session.', 401);
        if (!equal(req.headers['x-fieldwork-csrf'], s.csrf))
          throw new PlanError('Request session did not match.', 403);
        if (url.pathname === '/api/plan/status' && req.method === 'GET') {
          json(res, 200, await plan.status());
          return;
        }
        if (req.method !== 'POST')
          throw new PlanError('Method not allowed.', 405);
        if (!req.headers['content-type']?.startsWith('application/json'))
          throw new PlanError('Use a JSON request.', 415);
        const data = await body(req);
        if (url.pathname === '/api/plan/sign-in') {
          json(res, 200, {
            url: await plan.begin(
              s.id,
              `${origin}/auth/callback`,
              data.accountId,
            ),
          });
          return;
        }
        if (url.pathname === '/api/plan/sign-out') {
          json(res, 200, await plan.signOut());
          return;
        }
        if (url.pathname === '/api/plan/select') {
          await plan.select(data.accountId);
          json(res, 200, { ok: true });
          return;
        }
        if (url.pathname === '/api/plan/decide') {
          if (!validObservation(data.observation))
            throw new PlanError('Invalid agent observation.');
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 55000);
          res.on('close', () => {
            if (!res.writableEnded) controller.abort();
          });
          try {
            json(res, 200, {
              action: await plan.decide(data.observation, controller.signal),
            });
          } finally {
            clearTimeout(timer);
          }
          return;
        }
        throw new PlanError('Not found.', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method))
        throw new PlanError('Method not allowed.', 405);
      let path = resolve(
        root,
        '.' +
          decodeURIComponent(
            url.pathname === '/' ? '/index.html' : url.pathname,
          ),
      );
      if (!path.startsWith(root + sep)) throw new PlanError('Forbidden.', 403);
      path = await realpath(path);
      if (!path.startsWith(root + sep)) throw new PlanError('Forbidden.', 403);
      const data = await readFile(path);
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.webmanifest': 'application/manifest+json',
        '.png': 'image/png',
      };
      res.writeHead(200, {
        'Content-Type': types[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const message =
        error instanceof PlanError
          ? error.message
          : error.name === 'AbortError'
            ? 'Model decision timed out. Local rules will be used.'
            : error.code === 'ENOENT'
              ? 'Not found.'
              : 'The request could not be completed. Try again.';
      if (!res.headersSent)
        json(
          res,
          error instanceof PlanError
            ? error.status
            : error.code === 'ENOENT'
              ? 404
              : 502,
          {
            error: message,
            code: error instanceof PlanError ? error.code : 'request_failed',
          },
        );
      else res.end();
    }
  });
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const root = resolve('dist'),
    port = Number(process.env.FIELDWORK_PORT ?? 4173);
  try {
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('FIELDWORK_PORT must be from 1024 to 65535.');
    await stat(join(root, 'index.html'));
    const plan = new OpenAIPlan({
      dataDir:
        process.env.FIELDWORK_DATA_DIR ??
        join(homedir(), '.config', 'fieldwork'),
    });
    await plan.init();
    createAppServer(plan, { root, port })
      .on('error', () => {
        console.error(
          'Could not start Fieldwork. Stop the other server on this port and try again.',
        );
        process.exitCode = 1;
      })
      .listen(port, '127.0.0.1', () =>
        console.log(`Fieldwork + AI: http://127.0.0.1:${port}`),
      );
  } catch {
    console.error(
      'Could not start the AI server. Run npm run build and check your local data directory permissions.',
    );
    process.exitCode = 1;
  }
}
