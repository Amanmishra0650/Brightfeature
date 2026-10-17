import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { createApp } from './server.js';
import config from '../vite.config.js';

test('development proxy permits same-origin admin login and rejects foreign origins', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bright-proxy-'));
  let backend;
  let web;
  try {
    const app = await createApp({ dataDir: dir, adminPassword: 'proxy-test-password' });
    backend = app.listen(0, '127.0.0.1');
    await new Promise(resolve => backend.once('listening', resolve));
    const configured = config.server.proxy['/api'];
    const target = `http://127.0.0.1:${backend.address().port}`;
    web = await createServer({
      configFile: false,
      optimizeDeps: { noDiscovery: true, include: [] },
      server: {
        host: '127.0.0.1', port: 0, open: false,
        proxy: { '/api': typeof configured === 'string' ? target : { ...configured, target } },
      },
    });
    await web.listen();
    const base = `http://127.0.0.1:${web.httpServer.address().port}`;
    const login = origin => fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'proxy-test-password' }),
    });
    const response = await login(base);
    assert.equal(response.status, 200, await response.text());
    assert.ok(response.headers.get('set-cookie'));
    assert.equal((await login('https://foreign.example')).status, 403);
  } finally {
    await web?.close();
    if (backend) await new Promise(resolve => backend.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
