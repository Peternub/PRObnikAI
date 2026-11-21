import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { exams, findExam } from '../server/bank.js';
import { schoolGrade, checkShort, validateAI } from '../server/grading.js';
import { validPayment } from '../server/payments.js';
import { cleanAnswer } from '../server/exams.js';

test('Банк, шкала, проверка ИИ и платежей', () => {
  assert.equal(exams.length, 14);
  assert.equal(findExam('math').tasks.length, 25);
  assert.equal(findExam('math').maxPoints, 31);
  assert.equal(schoolGrade(25, 1, findExam('math')), 2);
  assert.equal(schoolGrade(8, 2, findExam('math')), 3);
  assert.equal(schoolGrade(15, 2, findExam('math')), 4);
  assert.equal(schoolGrade(22, 2, findExam('math')), 5);
  assert.equal(checkShort(findExam('math').tasks[5], ' 1,25 ').points, 1);
  const task = findExam('math').tasks[19];
  assert.equal(validateAI({ points: 2, confidence: 0.7, feedback: 'Нечёткое фото.', needsReview: false }, task).review, true);
  assert.throws(() => validateAI({ points: 500, confidence: 1, feedback: 'Верно.', needsReview: false }, task));
  assert.throws(() => cleanAnswer({ text: '', image: 'data:image/png;base64,SGVsbG8=' }, task));
  const order = { id: 'order-1', amount: 29900 };
  const payment = { status: 'succeeded', paid: true, amount: { value: '299.00', currency: 'RUB' }, metadata: { orderId: 'order-1' } };
  assert.equal(validPayment(payment, order), true);
  assert.equal(validPayment({ ...payment, amount: { value: '1.00', currency: 'RUB' } }, order), false);
  assert.equal(validPayment({ ...payment, metadata: { orderId: 'other' } }, order), false);
});

test('Полный сценарий всех предметов, приватность, скидка и таймер', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'probnik-exams-'));
  const { server, store } = await createApp({ file: join(dir, 'state.json'), databaseUrl: undefined, demo: true, url: 'http://localhost:3000' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', data, cookie) => {
    const response = await fetch(url + path, { method, headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const login = async email => {
    const code = await request('/api/auth/code', 'POST', { email, consent: true });
    return (await request('/api/auth/verify', 'POST', { email, code: code.body.demoCode })).cookie;
  };
  try {
    const cookie = await login('student@example.ru');
    const stranger = await login('other@example.ru');
    assert.equal((await request('/api/exams')).body.exams.length, 14);
    for (const exam of exams) {
      const purchase = await request('/api/orders', 'POST', { examId: exam.id }, cookie);
      const order = purchase.body.order;
      assert.equal(order.amount, 29900);
      assert.equal((await request('/api/orders', 'POST', { examId: exam.id }, cookie)).body.order.id, order.id);
      assert.equal((await request('/api/attempts', 'POST', { orderId: order.id }, cookie)).status, 402);
      await request(`/api/orders/${order.id}/confirm-demo`, 'POST', {}, cookie);
      const created = await request('/api/attempts', 'POST', { orderId: order.id }, cookie);
      const id = created.body.attempt.id;
      assert.equal((await request('/api/attempts', 'POST', { orderId: order.id }, cookie)).body.attempt.id, id);
      assert.equal((await request(`/api/attempts/${id}`, 'GET', null, stranger)).status, 404);
      const active = await request(`/api/attempts/${id}`, 'GET', null, cookie);
      assert.equal(active.body.tasks[0].answers, undefined);
      assert.equal(active.body.tasks[0].explanation, undefined);
      for (const task of exam.tasks.filter(t => t.type === 'short')) {
        assert.equal((await request(`/api/attempts/${id}/answers`, 'PATCH', { taskId: task.id, text: task.answers[0] }, cookie)).status, 200);
      }
      const written = exam.tasks.find(t => t.type === 'written');
      await request(`/api/attempts/${id}/answers`, 'PATCH', { taskId: written.id, text: 'Моё решение для перепроверки.' }, cookie);
      await request(`/api/attempts/${id}/submit`, 'POST', {}, cookie);
      let complete;
      for (let i = 0; i < 100; i++) {
        complete = await request(`/api/attempts/${id}`, 'GET', null, cookie);
        if (complete.body.attempt.status === 'complete') break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(complete.body.attempt.status, 'complete');
      assert.equal(complete.body.attempt.result.review, true);
      assert.equal(complete.body.attempt.result.points, exam.tasks.filter(t => t.type === 'short').length);
      assert.ok(complete.body.tasks[0].explanation);
      assert.equal((await request(`/api/attempts/${id}/answers`, 'PATCH', { taskId: 1, text: '99' }, cookie)).status, 409);
      const repeat = await request('/api/orders', 'POST', { examId: exam.id }, cookie);
      assert.equal(repeat.body.order.amount, 22425);
      assert.equal(repeat.body.order.discount, 25);
    }
    const order = (await request('/api/orders', 'POST', { examId: 'russian' }, cookie)).body.order;
    await request(`/api/orders/${order.id}/confirm-demo`, 'POST', {}, cookie);
    const attempt = (await request('/api/attempts', 'POST', { orderId: order.id }, cookie)).body.attempt;
    await store.transaction(tx => tx.put('attempts', { ...tx.get('attempts', attempt.id), deadline: Date.now() - 1000 }));
    assert.equal((await request(`/api/attempts/${attempt.id}/answers`, 'PATCH', { taskId: 1, text: 'е' }, cookie)).status, 409);
    assert.equal((await request(`/api/attempts/${attempt.id}`, 'GET', null, cookie)).body.attempt.status, 'checking');
    assert.equal((await request('/api/dashboard', 'GET', null, cookie)).body.attempts.length, 15);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
