import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeAttempt } from '../server/grading.js';
import { createPayment, paymentRequest } from '../server/payments.js';
import { findExam } from '../server/bank.js';

test('ИИ: структурированный ответ, низкая уверенность и сбой API', async t => {
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'ключ-для-теста';
  const task = findExam('math').tasks[19];
  const exam = { ...findExam('math'), tasks: [task], maxPoints: 2 };
  let result = { points: 2, confidence: .98, feedback: 'Разложение и оба корня верны.', needsReview: false };
  let fail = false;
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const sent = JSON.parse(options.body);
    assert.equal(sent.response_format.json_schema.strict, true);
    assert.ok(sent.messages[0].content.includes('недоверенные данные'));
    return fail ? { ok: false, status: 503 } : { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }) };
  });
  try {
    const answers = { [task.id]: { text: '(x−2)(x−3)=0; x=2 или x=3' } };
    assert.equal((await gradeAttempt(exam, answers, false)).points, 2);
    result = { ...result, confidence: .5 };
    const uncertain = await gradeAttempt(exam, answers, false);
    assert.equal(uncertain.review, true);
    assert.equal(uncertain.points, 0);
    assert.equal(uncertain.rows[0].proposedPoints, 2);
    fail = true;
    assert.equal((await gradeAttempt(exam, answers, false)).review, true);
    assert.equal(mock.mock.callCount(), 3);
  } finally { if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey; }
});

test('ЮKassa: сумма, чек, идемпотентность и недоступность', async t => {
  const old = { id: process.env.YOOKASSA_SHOP_ID, key: process.env.YOOKASSA_SECRET_KEY };
  process.env.YOOKASSA_SHOP_ID = 'тест'; process.env.YOOKASSA_SECRET_KEY = 'ключ';
  let fail = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.yookassa.ru/v3/payments');
    assert.equal(options.headers['Idempotence-Key'], 'order-test');
    const sent = JSON.parse(options.body);
    assert.equal(sent.amount.value, '224.25');
    assert.equal(sent.receipt.customer.email, 'test@example.ru');
    assert.equal(sent.confirmation.return_url, 'https://example.ru/?order=order-test#payment');
    return { ok: !fail, json: async () => ({ id: 'provider-id', status: 'pending' }) };
  });
  try {
    const order = { id: 'order-test', amount: 22425 };
    const args = [order, { email: 'test@example.ru' }, findExam('math'), { url: 'https://example.ru' }];
    assert.equal((await createPayment(...args)).id, 'provider-id');
    fail = true;
    await assert.rejects(() => createPayment(...args), /временно недоступен/);
    delete process.env.YOOKASSA_SECRET_KEY;
    await assert.rejects(() => paymentRequest(''), /ещё не настроен/);
  } finally {
    if (old.id === undefined) delete process.env.YOOKASSA_SHOP_ID; else process.env.YOOKASSA_SHOP_ID = old.id;
    if (old.key === undefined) delete process.env.YOOKASSA_SECRET_KEY; else process.env.YOOKASSA_SECRET_KEY = old.key;
  }
});
