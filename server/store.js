import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const empty = () => ({ users: {}, codes: {}, sessions: {}, orders: {}, attempts: {} });

async function replaceFile(source, target) {
  // В Windows антивирус может кратковременно удерживать файл после записи.
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, target); return; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 6) throw error;
      await delay(25 * (attempt + 1));
    }
  }
}

export async function createStore({ databaseUrl, file = resolve('.data/state.json') } = {}) {
  let pool;
  let state = empty();
  let queue = Promise.resolve();
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: databaseUrl, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false });
    await pool.query(`CREATE TABLE IF NOT EXISTS probnik_records (
      collection TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL,
      PRIMARY KEY (collection, id)
    )`);
  } else {
    try { state = { ...empty(), ...JSON.parse(await readFile(file, 'utf8')) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async function transaction(fn) {
    const run = async () => {
      const client = pool ? await pool.connect() : null;
      let draft;
      try {
        if (client) {
          await client.query('BEGIN');
          // Блокировка сериализует покупки, выдачу доступа и сохранение ответов.
          await client.query('SELECT pg_advisory_xact_lock(28471036)');
          draft = empty();
          const { rows } = await client.query('SELECT collection, id, data FROM probnik_records');
          for (const row of rows) if (draft[row.collection]) draft[row.collection][row.id] = row.data;
        } else draft = structuredClone(state);
        const changed = new Map();
        const removed = [];
        const tx = {
          get: (table, id) => draft[table][id],
          list: (table) => Object.values(draft[table]),
          put(table, record) { draft[table][record.id] = record; changed.set(`${table}:${record.id}`, [table, record]); return record; },
          remove(table, id) { delete draft[table][id]; removed.push([table, id]); },
        };
        const result = await fn(tx);
        if (client) {
          for (const [table, record] of changed.values()) await client.query('INSERT INTO probnik_records(collection,id,data) VALUES($1,$2,$3) ON CONFLICT(collection,id) DO UPDATE SET data=EXCLUDED.data', [table, record.id, record]);
          for (const [table, id] of removed) await client.query('DELETE FROM probnik_records WHERE collection=$1 AND id=$2', [table, id]);
          await client.query('COMMIT');
        } else if (changed.size || removed.length) {
          await mkdir(dirname(file), { recursive: true });
          await writeFile(`${file}.tmp`, JSON.stringify(draft), { mode: 0o600 });
          await replaceFile(`${file}.tmp`, file);
          state = draft;
        }
        return structuredClone(result);
      } catch (error) {
        if (client) await client.query('ROLLBACK');
        throw error;
      } finally { client?.release(); }
    };
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  }
  return { transaction, close: () => pool?.end() };
}
