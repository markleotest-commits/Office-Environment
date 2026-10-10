// Local, dependency-free server for the bundled offline build.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
const root = resolve('dist');
const port = Number(process.env.FIELDWORK_PORT ?? 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};
try {
  await stat(resolve(root, 'index.html'));
} catch {
  console.error('Build the app first with npm run build.');
  process.exit(1);
}
createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405).end();
    return;
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = resolve(
      root,
      '.' +
        decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
    );
    if (!path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const data = await readFile(path);
    res.writeHead(200, {
      'Content-Type': types[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404).end('Not found');
  }
})
  .on('error', (error) => {
    console.error(
      `Could not start server: ${error.message}. Stop the other server or set FIELDWORK_PORT to another port.`,
    );
    process.exitCode = 1;
  })
  .listen(port, '127.0.0.1', () =>
    console.log(`Fieldwork: http://127.0.0.1:${port}`),
  );
