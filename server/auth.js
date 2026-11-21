import { createHash, randomInt, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { assert, body, json } from './http.js';
export const hash = (value) => createHash('sha256').update(value).digest('hex');
const safeEqual = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createAuth(store, config) {
  const limits = new Map();
  function rate(req) {
    const ip = req.socket.remoteAddress;
    const now = Date.now();
    for (const [key, value] of limits) if (value.until < now) limits.delete(key);
    const entry = limits.get(ip) || { count: 0, until: now + 15 * 60_000 };
    assert(++entry.count <= 30, 429, 'Слишком много попыток. Попробуйте через 15 минут.');
    limits.set(ip, entry);
  }
  async function user(req) {
    const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('probnik_session='))?.slice(16);
    if (!token) return null;
    return store.transaction(tx => {
      const session = tx.get('sessions', hash(token));
      if (!session || session.expires < Date.now()) return null;
      const found = tx.get('users', session.userId);
      return found ? { id: found.id, email: found.email, name: found.name } : null;
    });
  }
  async function requireUser(req) { const found = await user(req); assert(found, 401, 'Войдите в аккаунт.'); return found; }
  const cookie = (token, age) => `probnik_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${config.url.startsWith('https:') ? '; Secure' : ''}`;
  async function handle(req, res, path) {
    if (path === '/api/auth/code' && req.method === 'POST') {
      rate(req);
      const data = await body(req, 4096);
      const email = String(data.email || '').trim().toLowerCase();
      assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254, 400, 'Укажите корректную почту.');
      assert(data.consent === true, 400, 'Нужно согласие на обработку данных.');
      const code = String(randomInt(100000, 1000000));
      await store.transaction(tx => {
        for (const entry of tx.list('codes')) if (entry.expires < Date.now()) tx.remove('codes', entry.id);
        const previous = tx.get('codes', hash(email));
        assert(!previous || previous.sentAt < Date.now() - 60_000, 429, 'Повторный код можно запросить через минуту.');
        tx.put('codes', { id: hash(email), email, code: hash(code), attempts: 0, sentAt: Date.now(), expires: Date.now() + 10 * 60_000 });
      });
      if (!config.demo) {
        const { default: mail } = await import('nodemailer');
        const transport = mail.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_PORT === '465', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
        try { await transport.sendMail({ from: process.env.MAIL_FROM, to: email, subject: 'Код входа в AI-Пробник', text: `Ваш код: ${code}. Действует 10 минут. Никому его не сообщайте.` }); }
        catch { await store.transaction(tx => tx.remove('codes', hash(email))); assert(false, 503, 'Не удалось отправить письмо. Попробуйте позже.'); }
      }
      json(res, { ok: true, ...(config.demo ? { demoCode: code } : {}) }); return true;
    }
    if (path === '/api/auth/verify' && req.method === 'POST') {
      rate(req);
      const data = await body(req, 4096);
      const email = String(data.email || '').trim().toLowerCase();
      const token = randomBytes(32).toString('hex');
      const result = await store.transaction(tx => {
        const entry = tx.get('codes', hash(email));
        if (!entry || entry.expires < Date.now() || entry.attempts >= 5) return null;
        entry.attempts++;
        tx.put('codes', entry);
        if (!safeEqual(entry.code, hash(String(data.code || '')))) return null;
        tx.remove('codes', entry.id);
        let found = tx.list('users').find(u => u.email === email);
        if (!found) found = tx.put('users', { id: randomUUID(), email, name: email.split('@')[0], createdAt: new Date().toISOString(), consentAt: new Date().toISOString() });
        for (const old of tx.list('sessions')) if (old.expires < Date.now()) tx.remove('sessions', old.id);
        tx.put('sessions', { id: hash(token), userId: found.id, expires: Date.now() + 30 * 24 * 60 * 60_000 });
        return { id: found.id, email: found.email, name: found.name };
      });
      assert(result, 400, 'Неверный или просроченный код.');
      json(res, { user: result }, 200, { 'Set-Cookie': cookie(token, 2592000) }); return true;
    }
    if (path === '/api/auth/logout' && req.method === 'POST') {
      const token = req.headers.cookie?.match(/(?:^|;\s*)probnik_session=([^;]+)/)?.[1];
      if (token) await store.transaction(tx => tx.remove('sessions', hash(token)));
      json(res, { ok: true }, 200, { 'Set-Cookie': cookie('', 0) }); return true;
    }
    return false;
  }
  return { user, requireUser, handle };
}
