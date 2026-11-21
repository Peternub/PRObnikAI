import { randomUUID } from 'node:crypto';
import { exams, findExam, publicExam, publicTasks } from './bank.js';
import { assert, body, json } from './http.js';
import { gradeAttempt } from './grading.js';
import { createPayment, paymentRequest, validPayment } from './payments.js';

const owns = (record, user) => { assert(record && record.userId === user.id, 404, 'Запись не найдена.'); return record; };
const orderView = ({ examSnapshot, userId, ...order }) => order;
const attemptExam = attempt => attempt.examSnapshot || findExam(attempt.examId);
export function cleanAnswer(data, task) {
  assert(typeof data.text === 'string' && data.text.length <= (task.type === 'short' ? 200 : 6000), 400, 'Ответ слишком длинный или некорректный.');
  let image = null;
  if (data.image) {
    assert(task.type === 'written' && typeof data.image === 'string', 400, 'Фотография допустима только в развёрнутом ответе.');
    const match = data.image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    assert(match && match[2].length < 11_184_816, 400, 'Прикрепите PNG, JPEG или WebP размером до 8 МБ.');
    const bytes = Buffer.from(match[2], 'base64');
    const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    assert(valid && bytes.length <= 8 * 1024 * 1024, 400, 'Формат или содержимое фотографии некорректны.');
    image = data.image;
  }
  return { text: data.text, image };
}
export function createExams(store, auth, config) {
  const jobs = new Set();
  let stopped = false;
  async function processAttempt(id) {
    if (jobs.has(id) || stopped) return;
    jobs.add(id);
    try {
      const attempt = await store.transaction(tx => tx.get('attempts', id));
      if (attempt?.status !== 'checking') return;
      const exam = attemptExam(attempt);
      const result = await gradeAttempt(exam, attempt.answers, config.demo);
      await store.transaction(tx => {
        const current = tx.get('attempts', id);
        if (current.status === 'checking') tx.put('attempts', { ...current, status: 'complete', result, completedAt: new Date().toISOString() });
      });
    } catch (error) { console.error('Не удалось сохранить проверку:', error.message); }
    finally { jobs.delete(id); }
  }
  const submit = (tx, attempt) => {
    if (attempt.status === 'active') tx.put('attempts', { ...attempt, status: 'checking', submittedAt: new Date().toISOString() });
  };
  async function sweep() {
    if (stopped) return;
    const ids = await store.transaction(tx => {
      for (const a of tx.list('attempts')) if (a.status === 'active' && a.deadline <= Date.now()) submit(tx, a);
      return tx.list('attempts').filter(a => a.status === 'checking').map(a => a.id);
    });
    // Одновременно проверяется только одна работа: нагрузка на LLM ограничена.
    if (!jobs.size && ids.length) void processAttempt(ids[0]);
  }
  const timer = setInterval(() => sweep().catch(error => console.error('Ошибка фоновой проверки:', error.message)), 2000);
  timer.unref();
  const summary = (attempt) => ({ id: attempt.id, examId: attempt.examId, title: attemptExam(attempt).title, status: attempt.status, startedAt: attempt.startedAt, completedAt: attempt.completedAt, deadline: attempt.deadline, result: attempt.result ? { points: attempt.result.points, maxPoints: attempt.result.maxPoints, percent: attempt.result.percent, grade: attempt.result.grade, review: attempt.result.review } : null });
  async function handle(req, res, path) {
    if (path === '/api/exams' && req.method === 'GET') { json(res, { exams: exams.map(publicExam) }); return true; }
    if (!/^\/api\/(dashboard|orders|attempts)/.test(path)) return false;
    const user = await auth.requireUser(req);
    if (path === '/api/dashboard' && req.method === 'GET') {
      const data = await store.transaction(tx => ({ attempts: tx.list('attempts').filter(a => a.userId === user.id).map(summary).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), orders: tx.list('orders').filter(o => o.userId === user.id && o.status === 'paid').map(o => ({ id: o.id, examId: o.examId, attemptId: o.attemptId, amount: o.amount })) }));
      json(res, data); return true;
    }
    if (path === '/api/orders' && req.method === 'POST') {
      const data = await body(req, 4096);
      const exam = findExam(data.examId);
      assert(exam, 404, 'Предмет не найден.');
      assert(config.demo || (!exam.demo && process.env.BANK_APPROVED === 'true'), 503, 'Этот банк учебный. Платная продажа откроется после экспертной проверки.');
      let order = await store.transaction(tx => {
        const pending = tx.list('orders').find(o => o.userId === user.id && o.examId === exam.id && o.version === exam.version && !o.attemptId && ['pending', 'paid'].includes(o.status));
        if (pending) return pending;
        const repeat = tx.list('attempts').some(a => a.userId === user.id && a.examId === exam.id && a.version === exam.version && a.status === 'complete');
        return tx.put('orders', { id: randomUUID(), userId: user.id, examId: exam.id, examSnapshot: structuredClone(exam), version: exam.version, amount: repeat ? Math.round(exam.price * 0.75) : exam.price, discount: repeat ? 25 : 0, status: 'pending', createdAt: new Date().toISOString() });
      });
      if (!config.demo && !order.paymentId && order.status !== 'paid') {
        const payment = await createPayment(order, user, order.examSnapshot || exam, config);
        order = await store.transaction(tx => tx.put('orders', { ...tx.get('orders', order.id), paymentId: payment.id, confirmationUrl: payment.confirmation?.confirmation_url }));
      }
      json(res, { order: orderView(order), demo: config.demo }); return true;
    }
    const orderMatch = path.match(/^\/api\/orders\/([\w-]+)(\/confirm-demo)?$/);
    if (orderMatch) {
      let order = await store.transaction(tx => owns(tx.get('orders', orderMatch[1]), user));
      if (orderMatch[2] && req.method === 'POST') {
        assert(config.demo, 404, 'Маршрут не найден.');
        order = await store.transaction(tx => tx.put('orders', { ...owns(tx.get('orders', order.id), user), status: 'paid' }));
      } else if (!orderMatch[2] && req.method === 'GET') {
        if (!config.demo && order.paymentId && order.status === 'pending') {
          const payment = await paymentRequest(`/${encodeURIComponent(order.paymentId)}`);
          if (validPayment(payment, order) || payment.status === 'canceled') order = await store.transaction(tx => tx.put('orders', { ...tx.get('orders', order.id), status: validPayment(payment, order) ? 'paid' : 'canceled' }));
        }
      } else return false;
      json(res, { order: orderView(order), demo: config.demo }); return true;
    }
    if (path === '/api/attempts' && req.method === 'POST') {
      const data = await body(req, 4096);
      const attempt = await store.transaction(tx => {
        const order = owns(tx.get('orders', data.orderId), user);
        assert(order.status === 'paid', 402, 'Сначала оплатите пробник.');
        if (order.attemptId) return tx.get('attempts', order.attemptId);
        const exam = order.examSnapshot || findExam(order.examId);
        const created = tx.put('attempts', { id: randomUUID(), userId: user.id, orderId: order.id, examId: exam.id, examSnapshot: structuredClone(exam), version: exam.version, status: 'active', startedAt: new Date().toISOString(), deadline: Date.now() + exam.durationMinutes * 60_000, answers: {} });
        tx.put('orders', { ...order, attemptId: created.id });
        return created;
      });
      json(res, { attempt: summary(attempt) }); return true;
    }
    const attemptMatch = path.match(/^\/api\/attempts\/([\w-]+)(?:\/(answers|submit))?$/);
    if (attemptMatch) {
      const [, id, action] = attemptMatch;
      const attempt = await store.transaction(tx => owns(tx.get('attempts', id), user));
      const exam = attemptExam(attempt);
      if (!action && req.method === 'GET') {
        if (attempt.status === 'active' && attempt.deadline <= Date.now()) {
          await store.transaction(tx => submit(tx, owns(tx.get('attempts', id), user)));
          json(res, { attempt: { ...summary(attempt), status: 'checking' }, serverTime: Date.now() });
        } else {
          const { userId, examSnapshot, ...view } = attempt;
          json(res, { attempt: view, exam: publicExam(exam), tasks: attempt.status === 'complete' ? exam.tasks.map(({ criteria, ...task }) => task) : publicTasks(exam), serverTime: Date.now() });
        }
        return true;
      }
      if (action === 'answers' && req.method === 'PATCH') {
        const data = await body(req);
        const task = exam.tasks.find(t => t.id === data.taskId);
        assert(task, 400, 'Задание не найдено.');
        const answer = cleanAnswer(data, task);
        await store.transaction(tx => {
          const current = owns(tx.get('attempts', id), user);
          assert(current.status === 'active' && current.deadline > Date.now(), 409, 'Экзамен уже завершён.');
          tx.put('attempts', { ...current, answers: { ...current.answers, [task.id]: answer } });
        });
        json(res, { ok: true, savedAt: Date.now() }); return true;
      }
      if (action === 'submit' && req.method === 'POST') {
        await store.transaction(tx => submit(tx, owns(tx.get('attempts', id), user)));
        void sweep().catch(error => console.error('Ошибка запуска проверки:', error.message));
        json(res, { ok: true }); return true;
      }
    }
    return false;
  }
  return { handle, stop() { stopped = true; clearInterval(timer); } };
}
