import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { createStore } from './store.js';
import { createAuth } from './auth.js';
import { createExams } from './exams.js';
import { assert, json } from './http.js';

export async function createApp(options = {}) {
  const settings = { ...config, ...options };
  const store = await createStore({ databaseUrl: settings.databaseUrl, file: settings.file });
  const auth = createAuth(store, settings);
  const exams = createExams(store, auth, settings);
  const root = resolve('public');
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const path = new URL(req.url, settings.url).pathname;
      if (path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) {
          assert(req.headers.origin === new URL(settings.url).origin, 403, 'Недопустимый источник запроса.');
        }
        if (path === '/api/health') return json(res, { ok: true, demo: settings.demo });
        if (path === '/api/me' && req.method === 'GET') return json(res, { user: await auth.user(req), demo: settings.demo });
        if (await auth.handle(req, res, path)) return;
        if (await exams.handle(req, res, path)) return;
        return json(res, { error: 'Маршрут не найден.' }, 404);
      }
      assert(['GET', 'HEAD'].includes(req.method), 405, 'Метод не поддерживается.');
      const file = resolve(root, `.${decodeURIComponent(path === '/' ? '/index.html' : path)}`);
      assert(file.startsWith(root + sep), 403, 'Доступ запрещён.');
      const data = await readFile(file);
      const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
      if (status === 500) console.error('Ошибка сервера:', error.message);
      json(res, { error: status === 500 ? 'Не удалось выполнить запрос. Попробуйте позже.' : error.message }, status);
    }
  });
  server.on('close', () => { exams.stop(); void store.close(); });
  return { server, store, auth };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { server } = await createApp();
  server.listen(config.port, config.host, () => console.log(`AI-Пробник: ${config.url} (${config.demo ? 'деморежим' : 'рабочий режим'})`));
}
