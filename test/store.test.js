import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.js';

async function verify(store) {
  const id = randomUUID();
  try {
    await store.transaction(tx => tx.put('users', { id, count: 0 }));
    await assert.rejects(() => store.transaction(tx => { tx.put('users', { id, count: 999 }); throw new Error('Откат'); }));
    assert.equal((await store.transaction(tx => tx.get('users', id))).count, 0);
    await Promise.all(Array.from({ length: 12 }, () => store.transaction(tx => { const value = tx.get('users', id); tx.put('users', { ...value, count: value.count + 1 }); })));
    assert.equal((await store.transaction(tx => tx.get('users', id))).count, 12);
  } finally { await store.transaction(tx => tx.remove('users', id)); await store.close(); }
}
test('Локальное хранилище: откат и параллельные изменения', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'probnik-store-'));
  try { await verify(await createStore({ file: join(dir, 'state.json') })); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
test('PostgreSQL: откат и параллельные изменения', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  await verify(await createStore({ databaseUrl: process.env.TEST_DATABASE_URL }));
});
