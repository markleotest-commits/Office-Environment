import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : `${dir}/${e.name}`,
    ),
  );
  return nested.flat();
}
const files = (await walk('dist')).filter((p) => !p.endsWith('/sw.js'));
const hash = createHash('sha256');
for (const file of files.sort()) hash.update(await readFile(file));
const version = hash.digest('hex').slice(0, 16);
const urls = files.map((p) => `./${p.slice(5)}`);
// Scope-qualified cache names prevent multiple installations on one origin colliding.
const script = `const PREFIX = 'fieldwork:' + self.registration.scope + ':';
const CACHE = PREFIX + ${JSON.stringify(version)};
const ASSETS = ${JSON.stringify(urls)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    if (event.request.mode === 'navigate') {
      try { return await fetch(event.request); }
      catch { return await cache.match(new URL('./index.html', self.registration.scope).href) || Response.error(); }
    }
    return await cache.match(event.request) || fetch(event.request);
  }));
});`;
await writeFile('dist/sw.js', script);
console.log(`Offline cache built: ${urls.length} files, version ${version}`);
