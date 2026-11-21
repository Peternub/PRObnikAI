import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';

test('Вход по коду, ограничение попыток и выход', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'probnik-auth-'));
  const { server } = await createApp({ file: join(dir, 'state.json'), databaseUrl: undefined, demo: true, url: 'http://localhost:3000' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, data, cookie) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(data) });
  try {
    const email = 'ученик@example.ru';
    assert.equal((await post('/api/auth/code', { email })).status, 400);
    const code = await (await post('/api/auth/code', { email, consent: true })).json();
    assert.match(code.demoCode, /^\d{6}$/);
    assert.equal((await post('/api/auth/verify', { email, code: '000000' })).status, 400);
    const login = await post('/api/auth/verify', { email, code: code.demoCode });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await fetch(url + '/api/me', { headers: { Cookie: cookie } })).json()).user.email, email);
    assert.equal((await post('/api/auth/verify', { email, code: code.demoCode })).status, 400);
    await post('/api/auth/logout', {}, cookie);
    assert.equal((await (await fetch(url + '/api/me', { headers: { Cookie: cookie } })).json()).user, null);
    assert.equal((await fetch(url + '/api/auth/code', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
