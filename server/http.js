export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function assert(condition, status, message) { if (!condition) throw new HttpError(status, message); }
export function json(res, data, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}
export async function body(req, limit = 12 * 1024 * 1024) {
  assert(req.headers['content-type']?.startsWith('application/json'), 415, 'Ожидается JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    assert(size <= limit, 413, 'Файл слишком большой. Максимум — 8 МБ.');
    chunks.push(chunk);
  }
  try { const value = JSON.parse(Buffer.concat(chunks).toString()); assert(value && typeof value === 'object' && !Array.isArray(value), 400, 'Некорректные данные.'); return value; }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Некорректный JSON.'); }
}
