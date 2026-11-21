import { assert } from './http.js';
export async function paymentRequest(path, { method = 'GET', data, key } = {}) {
  assert(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY, 503, 'Приём платежей ещё не настроен.');
  const response = await fetch(`https://api.yookassa.ru/v3/payments${path}`, {
    method, signal: AbortSignal.timeout(20_000), headers: { Authorization: `Basic ${Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`).toString('base64')}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotence-Key': key } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}),
  });
  assert(response.ok, 503, 'Платёжный сервис временно недоступен. Повторите запрос.');
  return response.json();
}
export function validPayment(payment, order) {
  return payment.status === 'succeeded' && payment.paid === true && payment.amount?.currency === 'RUB' && payment.amount.value === (order.amount / 100).toFixed(2) && payment.metadata?.orderId === order.id;
}
export async function createPayment(order, user, exam, config) {
  return paymentRequest('', { method: 'POST', key: order.id, data: {
    amount: { value: (order.amount / 100).toFixed(2), currency: 'RUB' }, capture: true,
    confirmation: { type: 'redirect', return_url: `${config.url}/?order=${order.id}#payment` },
    description: `AI-Пробник: ${exam.title}, ${exam.variant}`,
    metadata: { orderId: order.id },
    receipt: { customer: { email: user.email }, items: [{ description: `Пробник: ${exam.title}`, quantity: '1.00', amount: { value: (order.amount / 100).toFixed(2), currency: 'RUB' }, vat_code: Number(process.env.RECEIPT_VAT_CODE || 1), payment_mode: 'full_payment', payment_subject: 'service' }] },
  } });
}
