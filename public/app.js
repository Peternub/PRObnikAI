const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = (kopecks) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: kopecks % 100 ? 2 : 0 }).format(kopecks / 100);
const date = value => new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const taskCount = count => `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'задание' : [2,3,4].includes(count % 10) && ![12,13,14].includes(count % 100) ? 'задания' : 'заданий'}`;
const paths = {
  check: 'M5 12l4 4L19 6', cross: 'M6 6l12 12M18 6L6 18', clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  sheet: 'M14 3H5v18h14V8l-5-5v5h5M8 12h8M8 16h5', lock: 'M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3',
  spark: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z', chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  book: 'M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1v15',
  back: 'M15 5l-7 7 7 7', upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5', user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-3a8 6 0 0 1 16 0v3',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.spark}"/></svg>`;
const brand = () => `<a href="#home" class="brand" aria-label="AI-Пробник — на главную"><span class="brand-mark">${icon('check')}</span>ПРОБНИК<span class="brand-ai">AI</span></a>`;
const state = { user: null, demo: true, exams: [], dashboard: null, page: '', category: 'all', search: '', renderId: 0, context: null };
let polling, ticking, saveDelay, toastDelay;
async function api(path, { method = 'GET', data } = {}) {
  let response;
  try { response = await fetch('/api' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }); }
  catch { throw new Error('Нет связи с сервером. Проверьте подключение и повторите попытку.'); }
  const value = await response.json();
  if (!response.ok) { const error = new Error(value.error || 'Не удалось выполнить запрос.'); error.status = response.status; throw error; }
  return value;
}
function toast(message) {
  clearTimeout(toastDelay); $('#toast').textContent = message; $('#toast').classList.add('visible');
  toastDelay = setTimeout(() => $('#toast').classList.remove('visible'), 4500);
}
function shell(exam) {
  $('#header').innerHTML = `<div class="wrap header-inner">${brand()}${exam ? `<div class="exam-header-info"><span class="exam-subject">${esc(exam.title)}</span><div class="timer" id="timer">${icon('clock')}<span>--:--:--</span></div></div>` : `<nav class="nav" aria-label="Основная навигация">${state.user ? '<a href="#catalog">Все предметы</a><a href="#profile">Мои пробники</a>' : '<a href="#how">Как это работает</a><a href="#subjects">Предметы</a><a href="#faq">Вопросы</a>'}</nav><div class="header-actions">${state.user ? `<a href="#profile" class="account-btn"><span class="avatar">${esc(state.user.name.slice(0, 1))}</span><span class="account-name">Мой профиль</span></a>` : `<button class="btn sm" data-action="login">Войти ${icon('user')}</button>`}</div>`}</div>`;
  $('#footer').innerHTML = exam ? '' : `<div class="footer"><div class="wrap"><div class="footer-top">${brand()}<div class="footer-links"><a href="#privacy">Обработка данных</a><a href="#terms">Условия использования</a><a href="#catalog">Все предметы</a></div></div><div class="footer-bottom"><p>Учебный сервис. Не является официальным ресурсом ФИПИ. Прогноз оценки не гарантирует результат на экзамене.</p><span>© ${new Date().getFullYear()} AI-Пробник</span></div></div></div>`;
}
const demoBanner = () => state.demo ? '<div class="demo-banner">Учебный режим · Оплата имитируется, деньги не списываются. Проверка развёрнутых решений требует перепроверки.</div>' : '';
const examById = id => state.exams.find(exam => exam.id === id);
function subjectCard(exam, compact = false) {
  const repeat = state.dashboard?.attempts.some(a => a.examId === exam.id && a.status === 'complete');
  return `<article class="subject-card"><div class="subject-top"><div class="subject-symbol" aria-hidden="true">${esc(exam.symbol)}</div><span class="chip ${repeat ? 'dark' : 'line'}">${repeat ? 'Повтор −25%' : 'Учебный вариант'}</span></div><h3>${esc(exam.title)}</h3><p>${esc(exam.description)}</p><div class="subject-meta"><span>${icon('sheet')}${taskCount(exam.taskCount)}</span><span>${icon('clock')}${exam.durationMinutes} мин</span></div><div class="subject-bottom"><div><div class="price">${state.demo ? 'Бесплатно' : money(repeat ? Math.round(exam.price * .75) : exam.price)}</div>${state.demo ? `<div class="demo-price">${compact ? 'для знакомства' : 'в учебном режиме'}</div>` : ''}</div><button class="btn sm ${exam.id === 'math' ? 'lime' : 'outline'}" data-action="choose" data-id="${exam.id}">${state.demo ? 'Попробовать' : 'Выбрать'}</button></div></article>`;
}
function landing() {
  state.page = 'landing'; shell();
  $('#main').innerHTML = `<div class="wrap"><section class="hero"><div><div class="eyebrow">Твоя репетиция перед ОГЭ</div><h1>ТВОЙ ОГЭ.<br>БЕЗ <span>СЮРПРИЗОВ.</span></h1><p class="hero-copy">Проверь, что ты уже знаешь. Найди, что стоит подтянуть. И приходи на экзамен с уверенностью.</p><div class="hero-actions"><a class="btn lime" href="#subjects">Выбрать предмет ${icon('sheet')}</a><a class="btn outline" href="#how">Как это работает</a></div><div class="hero-note">${icon('lock')}Учебные варианты доступны бесплатно</div></div><div class="hero-visual" aria-label="Иллюстрация примера разбора"><div class="visual-dots"></div><div class="exam-paper"><div class="paper-head"><span>AI-ПРОБНИК / МАТЕМАТИКА</span><span>01</span></div><div class="display paper-title">ЗНАНИЯ —<br>ПО ПОЛОЧКАМ.</div><div class="paper-row"><span class="paper-num">06</span><span>Числа и вычисления</span><span class="paper-answer">1,25</span><span class="paper-check">${icon('check')}</span></div><div class="paper-row"><span class="paper-num">09</span><span>Уравнения</span><span class="paper-answer">5</span><span class="paper-check">${icon('check')}</span></div><div class="paper-row"><span class="paper-num">15</span><span>Геометрия</span><span class="paper-answer">8</span><span class="paper-check wrong">${icon('cross')}</span></div><div class="paper-foot">Пример разбора · иллюстрация интерфейса</div></div><div class="score-sticker"><div class="display">+1 ШАГ</div><p>к уверенности</p></div><span class="visual-spark" aria-hidden="true">✳</span><div class="ai-note"><div class="eyebrow">${icon('spark')}Понятный разбор</div><p>В задании 15 пригодится <strong>теорема Пифагора.</strong> Разберём решение и вернёмся к этой теме.</p></div></div></section><div class="facts-strip"><div class="fact">${icon('book')}<div><strong>Все предметы</strong><span>14 направлений подготовки</span></div></div><div class="fact">${icon('clock')}<div><strong>В своём темпе</strong><span>С таймером и сохранением</span></div></div><div class="fact">${icon('spark')}<div><strong>Проверка решений</strong><span>Баллы и объяснения ошибок</span></div></div><div class="fact">${icon('chart')}<div><strong>План подготовки</strong><span>На основе твоих результатов</span></div></div></div><section class="section" id="subjects"><div class="section-head"><div><span class="eyebrow muted">С чего начнём?</span><h2>ВЫБЕРИ СВОЙ ПРЕДМЕТ.</h2></div><p>От математики до испанского.<br>Один пробник — один понятный шаг вперёд.</p></div><div class="subjects-grid">${state.exams.slice(0, 6).map(exam => subjectCard(exam, true)).join('')}</div><div class="all-subjects"><a href="#catalog" class="btn outline">Все 14 предметов</a></div></section><section id="how" class="dark-section"><div class="section-head"><div><span class="eyebrow">Всё проще, чем кажется</span><h2>ОТ ПРОБНИКА К ПЛАНУ.</h2></div><p class="muted">Никакой суеты.<br>Только ты, задания и твой результат.</p></div><div class="steps"><div><div class="step-icon">${icon('book')}</div><h3>Выбери предмет</h3><p>Войди по почте и открой учебный вариант. Для знакомства с сервисом оплата не нужна.</p></div><div><div class="step-icon">${icon('sheet')}</div><h3>Проверь свои знания</h3><p>Отвечай на вопросы и прикрепляй фото решений. Ответы сохраняются, а таймер помогает распределить время.</p></div><div><div class="step-icon">${icon('spark')}</div><h3>Разберись в ошибках</h3><p>Посмотри баллы, правильные ответы и объяснения. Сохрани результат и возвращайся к сложным темам.</p></div></div></section><section class="section insight"><div><span class="eyebrow muted">Ошибка — это точка роста</span><h2>НЕ ПРОСТО ОЦЕНКА.<br>ПОНИМАНИЕ.</h2><p>Узнай, где потерялись баллы и что повторить перед следующим пробником.</p><ul class="check-list"><li>${icon('check')}Правильные ответы и пошаговые решения</li><li>${icon('check')}Темы, которым стоит уделить внимание</li><li>${icon('check')}Вся история подготовки в профиле</li></ul><button class="btn outline" data-action="login">Начать подготовку</button></div><div class="insight-card"><div class="insight-card-head"><h3>Твоя карта знаний</h3><span class="chip line">Пример</span></div>${[['Алгебра',85],['Практические задачи',65],['Геометрия',40]].map(([topic, score]) => `<div class="topic-bar"><div class="topic-bar-label"><span>${topic}</span><span class="muted">${score}%</span></div><div class="bar"><div class="bar-fill w${score} ${score === 40 ? 'low' : ''}"></div></div></div>`).join('')}<div class="insight-tip">${icon('spark')}<p>Начни с геометрии: повтори теорему Пифагора и площади фигур.</p></div></div></section><section id="faq" class="faq section"><span class="eyebrow muted">Остались вопросы?</span><h2>ДАВАЙ РАЗБЕРЁМСЯ.</h2>${[
    ['Это настоящий вариант ОГЭ?', 'Сейчас доступны авторские учебные варианты: 25 заданий по математике и сокращённые варианты по другим предметам. Они помогают познакомиться с сервисом и не заменяют официальные материалы ФИПИ. Устная часть, аудирование, изложение и практические работы пока не включены.'],
    ['Как проверяются развёрнутые ответы?', 'В рабочем режиме ИИ анализирует текст и фотографию по заданным критериям. Неуверенные результаты помечаются для перепроверки. В учебном режиме решение сохраняется, но баллы за него не начисляются до проверки.'],
    ['Можно ли прерваться и вернуться?', 'Да. Сохранённые ответы доступны с того же аккаунта. Таймер продолжает идти, даже если закрыть вкладку. Когда время истечёт, работа отправится на проверку автоматически.'],
    ['Сколько стоит пробник?', 'Учебный режим бесплатный. Базовая цена полноценного пробника после запуска — 299 ₽. Повтор того же варианта — со скидкой 25%, новый вариант — по полной цене. Продажи откроются после экспертной проверки банка.'],
    ['Где найти мои результаты?', 'В профиле сохраняются пройденные пробники, баллы и разборы. Можно вернуться к любому результату и повторить темы, в которых возникли трудности.'],
  ].map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}</section><section class="last-cta"><div><h2>ОГЭ ДЛЯ ВАС.<br>И ДЛЯ ВАШИХ ЗНАНИЙ.</h2><p>Попробуй сейчас — и узнай, с чего начать подготовку.</p></div><a href="#subjects" class="btn">Выбрать пробник</a></section></div>`;
}
function historyRow(attempt) {
  const exam = examById(attempt.examId);
  return `<article class="history-row"><div class="history-main"><div class="subject-symbol">${esc(exam.symbol)}</div><div><h3>${esc(exam.title)}</h3><p>${date(attempt.startedAt)} · ${attempt.status === 'active' ? 'Можно продолжить' : attempt.status === 'checking' ? 'Проверяется' : attempt.result.review ? 'Есть задания на перепроверке' : 'Проверка завершена'}</p></div></div><div class="history-end">${attempt.result ? `<div class="history-score">${attempt.result.points}<span> / ${attempt.result.maxPoints} баллов</span></div>` : ''}<a class="btn outline sm" href="#attempt/${attempt.id}">${attempt.status === 'active' ? 'Продолжить' : attempt.status === 'checking' ? 'Статус' : 'Разбор ошибок'}</a></div></article>`;
}
function filterSubjects() {
  const found = state.exams.filter(exam => (!state.search || exam.title.toLowerCase().includes(state.search.toLowerCase())) && (state.category === 'all' || state.category === 'required' && ['math','russian'].includes(exam.id) || state.category === 'choice' && !['math','russian'].includes(exam.id)));
  $('#subject-list').innerHTML = found.length ? found.map(exam => subjectCard(exam)).join('') : '<div class="empty">Предмет не найден. Попробуй другой запрос.</div>';
}
async function catalog(profile = false) {
  state.page = profile ? 'profile' : 'catalog'; shell();
  state.dashboard = state.user ? await api('/dashboard') : { attempts: [], orders: [] };
  const { attempts, orders } = state.dashboard;
  const complete = attempts.filter(a => a.status === 'complete');
  const active = attempts.filter(a => a.status !== 'complete');
  const average = complete.length ? Math.round(complete.reduce((sum, a) => sum + a.result.percent, 0) / complete.length) + '%' : '—';
  if (profile) {
    $('#main').innerHTML = `<div class="wrap page">${demoBanner()}<div class="page-heading"><div><span class="eyebrow muted">Твоя подготовка</span><h1 class="page-title">МОИ ПРОБНИКИ.</h1><p class="profile-email page-subtitle">${esc(state.user.email)}</p></div><button class="btn outline sm" data-action="logout">Выйти</button></div><div class="stats"><div class="stat"><span class="stat-value">${complete.length}</span><span class="stat-label">Пройдено пробников</span></div><div class="stat"><span class="stat-value">${average}</span><span class="stat-label">Средний результат</span></div><div class="stat"><span class="stat-value">${active.length}</span><span class="stat-label">В процессе</span></div></div>${orders.filter(o => !o.attemptId).length ? `<h2 class="result-section-title">Готовы к прохождению</h2><div class="history">${orders.filter(o => !o.attemptId).map(o => `<div class="history-row"><h3>${esc(examById(o.examId).title)}</h3><a class="btn lime sm" href="#instruction/${o.id}">Открыть инструкцию</a></div>`).join('')}</div>` : ''}<h2 class="result-section-title">История подготовки</h2><div class="history">${attempts.length ? attempts.map(historyRow).join('') : `<div class="empty">${icon('book')}<p>Здесь появятся твои пробники и результаты.</p><a class="btn lime" href="#catalog">Выбрать первый предмет</a></div>`}</div></div>`;
  } else {
    $('#main').innerHTML = `<div class="wrap page">${demoBanner()}<div class="page-heading"><div><span class="eyebrow muted">${state.user ? 'Радуемся каждому твоему шагу' : 'Выбери, с чего начнём'}</span><h1 class="page-title">${state.user ? 'ТВОЙ СЛЕДУЮЩИЙ ШАГ.' : 'ВСЕ ПРЕДМЕТЫ ОГЭ.'}</h1><p class="page-subtitle">Один предмет. Один пробник. Больше уверенности.</p></div>${state.user ? '<a class="btn outline sm" href="#profile">Мои результаты</a>' : '<button class="btn lime" data-action="login">Войти и начать</button>'}</div>${active.length ? `<div class="history">${active.slice(0,2).map(historyRow).join('')}</div><h2 class="result-section-title">Выбери новый пробник</h2>` : ''}<div class="toolbar"><div class="tabs" role="group" aria-label="Категории предметов">${[['all','Все предметы'],['required','Обязательные'],['choice','По выбору']].map(([id,label]) => `<button class="tab ${state.category === id ? 'active' : ''}" data-action="filter" data-id="${id}" aria-pressed="${state.category === id}">${label}</button>`).join('')}</div><input class="search" type="search" placeholder="Найти предмет" aria-label="Найти предмет" value="${esc(state.search)}"></div><div id="subject-list" class="subjects-grid"></div><p class="field-hint">Учебные варианты: математика — 25 заданий; остальные предметы — по 4 задания. Это знакомство с сервисом, а не полная репетиция официального экзамена.</p></div>`;
    filterSubjects();
    $('.search').addEventListener('input', event => { state.search = event.target.value; filterSubjects(); });
  }
}
function openModal(html) { $('#modal').innerHTML = `<button class="modal-close" aria-label="Закрыть" data-action="close-modal">×</button>${html}`; if (!$('#modal').open) $('#modal').showModal(); }
function login(after = () => go('catalog')) {
  if (state.user) return after();
  openModal(`<span class="brand-mark">${icon('user')}</span><h2 id="modal-title">Твой первый шаг</h2><p>Войди по почте. Пришлём короткий код — пароль запоминать не нужно.</p><form id="login-form"><div><label class="field-label" for="email">Электронная почта</label><input id="email" name="email" type="email" autocomplete="email" required placeholder="you@example.ru" maxlength="254"></div><label class="consent"><input name="consent" type="checkbox" required><span>Соглашаюсь с <a href="#privacy" data-close-modal>обработкой данных</a> и <a href="#terms" data-close-modal>условиями использования</a>.</span></label><div class="form-error" role="alert"></div><button class="btn lime full" type="submit">Получить код</button></form>`);
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target; const button = $('button[type=submit]', form); button.disabled = true;
    const email = new FormData(form).get('email').trim();
    try {
      const result = await api('/auth/code', { method: 'POST', data: { email, consent: true } });
      codeForm(email, result.demoCode, after);
    } catch (error) { $('.form-error', form).textContent = error.message; button.disabled = false; }
  });
}
function codeForm(email, demoCode, after) {
  openModal(`<span class="brand-mark">${icon('lock')}</span><h2 id="modal-title">Проверь свою почту</h2><p>Код для входа: <strong>${esc(email)}</strong>. Он действует 10 минут.</p><form id="code-form"><div><label class="field-label" for="code">Шестизначный код</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"></div>${demoCode ? `<div class="demo-code">Учебный режим: письмо не отправляется.<strong>${esc(demoCode)}</strong></div>` : ''}<div class="form-error" role="alert"></div><button class="btn lime full" type="submit">Войти</button><button class="btn quiet" type="button" data-action="login">Изменить почту или запросить код</button></form>`);
  $('#code-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target; const button = $('button[type=submit]', form); button.disabled = true;
    try { const result = await api('/auth/verify', { method: 'POST', data: { email, code: new FormData(form).get('code') } }); state.user = result.user; $('#modal').close(); await after(); }
    catch (error) { $('.form-error', form).textContent = error.message; button.disabled = false; }
  });
}
async function checkout(examId) {
  const exam = examById(examId); if (!exam) throw new Error('Предмет не найден.');
  if (!state.user) { landing(); return login(() => go(`checkout/${examId}`)); }
  const { order } = await api('/orders', { method: 'POST', data: { examId } });
  if (order.status === 'paid') return go(order.attemptId ? `attempt/${order.attemptId}` : `instruction/${order.id}`);
  shell(); state.page = 'checkout';
  $('#main').innerHTML = `<div class="wrap page"><a class="back" href="#catalog">${icon('back')}Все предметы</a>${demoBanner()}<div class="checkout"><div><div class="subject-symbol">${esc(exam.symbol)}</div><h1>${esc(exam.title)}</h1><p>${esc(exam.variant)} · ${taskCount(exam.taskCount)} · ${exam.durationMinutes} минут</p><ul class="check-list"><li>${icon('check')}Автоматическая проверка кратких ответов</li><li>${icon('check')}Загрузка фотографий развёрнутых решений</li><li>${icon('check')}Результат и объяснения ошибок</li><li>${icon('check')}Доступ к разбору в личном кабинете</li></ul><div class="notice">Учебный вариант ${exam.id === 'math' ? 'содержит 25 авторских заданий' : 'сокращён до 4 заданий'}. Он не является официальным вариантом ФИПИ.</div></div><div class="panel receipt-panel"><h2 class="receipt-title">${state.demo ? 'Попробовать сервис' : 'Твой пробник'}</h2><div class="receipt-row"><span>${esc(exam.title)}</span><span>${money(exam.price)}</span></div>${order.discount ? `<div class="receipt-row discount"><span>Повтор того же варианта −25%</span><span>−${money(exam.price - order.amount)}</span></div>` : ''}${state.demo ? `<div class="receipt-row discount"><span>Учебный режим</span><span>Без списаний</span></div>` : ''}<div class="receipt-row total"><span>К оплате</span><span>${state.demo ? '0 ₽' : money(order.amount)}</span></div><button class="btn lime full" data-action="pay" data-id="${order.id}" data-url="${esc(order.confirmationUrl || '')}">${state.demo ? 'Начать бесплатно' : 'Перейти к оплате'}</button><p class="small muted">${state.demo ? 'Платёж имитируется. Банковская карта не нужна.' : 'Безопасная оплата через ЮKassa. Данные карты не передаются сервису.'}</p>${order.discount ? `<p class="small muted">Цена повтора после запуска: ${money(order.amount)}.</p>` : ''}</div></div></div>`;
}
async function paymentReturn() {
  const orderId = new URL(location.href).searchParams.get('order');
  if (!orderId) return go('catalog');
  if (!state.user) return login(paymentReturn);
  shell();
  const { order } = await api(`/orders/${encodeURIComponent(orderId)}`);
  if (order.status === 'paid') { history.replaceState(null, '', location.pathname + `#instruction/${order.id}`); return route(); }
  $('#main').innerHTML = `<div class="wrap page checking"><div class="checking-orbit">${icon('lock')}</div><h1>${order.status === 'canceled' ? 'ОПЛАТА ОТМЕНЕНА.' : 'ПРОВЕРЯЕМ ОПЛАТУ.'}</h1><p>${order.status === 'canceled' ? 'Можно вернуться к предметам и попробовать ещё раз.' : 'Доступ появится после подтверждения платежа. Если ты ещё не оплатил, вернись на страницу оплаты.'}</p><div class="hero-actions"><button class="btn lime" data-action="refresh">Проверить снова</button><a href="#catalog" class="btn outline">Все предметы</a></div></div>`;
  if (order.status === 'pending') polling = setTimeout(() => route(), 5000);
}
async function instruction(orderId) {
  if (!state.user) return login(() => go(`instruction/${orderId}`));
  const { order } = await api(`/orders/${orderId}`); const exam = examById(order.examId);
  if (order.attemptId) return go(`attempt/${order.attemptId}`);
  if (order.status !== 'paid') return go(`checkout/${exam.id}`);
  shell();
  $('#main').innerHTML = `<div class="wrap page"><div class="instruction"><a class="back" href="#catalog">${icon('back')}В каталог</a><div class="panel"><span class="chip">Всё готово</span><h1 class="page-title">ПЕРЕД СТАРТОМ.</h1><p class="muted">${esc(exam.title)} · ${taskCount(exam.taskCount)} · ${exam.durationMinutes} минут</p><ol class="instruction-list"><li>Приготовь бумагу и ручку. Выбери спокойное место, где тебя не будут отвлекать.</li><li>В кратких ответах вводи только то, что требуется в условии. Единицы измерения указывай, только если это оговорено.</li><li>В развёрнутых заданиях напиши решение или приложи чёткую фотографию. Поддерживаются PNG, JPEG и WebP до 8 МБ.</li><li>Переходи между заданиями в любом порядке. Дождись отметки «Ответ сохранён» перед закрытием вкладки.</li><li>Таймер начнётся после нажатия кнопки и продолжит идти, даже если закрыть страницу. По истечении времени работа завершится автоматически.</li></ol><div class="notice">${exam.demo ? 'Это учебный вариант. ' : ''}${state.demo ? 'Развёрнутые решения сохраняются для перепроверки без вызова внешнего ИИ.' : 'При подключённой модели текст и фото решений передаются провайдеру ИИ для анализа.'} Результат — ориентир для подготовки.</div><button class="btn lime full exam-finish" data-action="start" data-id="${order.id}">Всё понятно, начинаем</button></div></div></div>`;
}
function answered(answer) { return !!(answer?.text?.trim() || answer?.image); }
function saveStatus(text, error = false) { const el = $('#save-status'); if (el) { el.classList.toggle('error', error); el.innerHTML = `${icon(error ? 'cross' : 'check')}<span>${esc(text)}</span>${error ? '<button class="btn quiet sm" data-action="retry-save">Повторить</button>' : ''}`; } }
async function flush(context = state.context) {
  if (!context) return;
  clearTimeout(saveDelay);
  if (context.saving) { await context.saving; if (context.pending.size) return flush(context); return; }
  context.saving = (async () => {
    while (context.pending.size) {
      const [taskId, answer] = context.pending.entries().next().value; context.pending.delete(taskId);
      try { await api(`/attempts/${context.attempt.id}/answers`, { method: 'PATCH', data: { taskId, ...answer } }); }
      catch (error) { if (!context.pending.has(taskId)) context.pending.set(taskId, answer); saveStatus(error.message, true); throw error; }
    }
    saveStatus('Ответы сохранены');
  })();
  try { await context.saving; } finally { context.saving = null; }
}
function changed(taskId, answer) {
  const ctx = state.context;
  ctx.attempt.answers[taskId] = answer;
  ctx.pending.set(taskId, structuredClone(answer));
  saveStatus('Сохраняем…');
  document.querySelector(`[data-action="task"][data-id="${taskId}"]`)?.classList.toggle('answered', answered(answer));
  const count = Object.values(ctx.attempt.answers).filter(answered).length;
  $('#answer-count').textContent = `${count} из ${ctx.tasks.length} заданий с ответом`;
  clearTimeout(saveDelay); saveDelay = setTimeout(() => flush(ctx).catch(() => {}), 650);
}
function taskPanel() {
  const ctx = state.context; const task = ctx.tasks[ctx.index]; const answer = ctx.attempt.answers[task.id] || { text: '', image: null };
  for (const el of document.querySelectorAll('.task-num')) { const active = Number(el.dataset.id) === task.id; el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); }
  $('#task-panel').innerHTML = `<div class="task-card"><div class="task-heading"><h2>Задание ${task.id}</h2><span class="chip line">${task.maxPoints} ${task.maxPoints === 1 ? 'балл' : 'балла'}</span></div><div class="eyebrow muted">${esc(task.topic)}</div><p class="task-prompt">${esc(task.prompt)}</p><label class="field-label" for="answer">${task.type === 'short' ? 'Твой ответ' : 'Твоё решение'}</label>${task.type === 'short' ? `<input id="answer" class="answer-short" autocomplete="off" maxlength="200" placeholder="Введи ответ" value="${esc(answer.text)}"><p class="field-hint">Следуй формату в условии задания.</p>` : `<textarea id="answer" maxlength="6000" placeholder="Напиши ход решения или прикрепи фото…">${esc(answer.text)}</textarea><div class="upload-box"><label class="field-label" for="photo">${icon('upload')}Фотография решения</label><p>PNG, JPEG или WebP · до 8 МБ. Можно вставить изображение из буфера в поле решения.</p><input id="photo" type="file" accept="image/png,image/jpeg,image/webp">${answer.image ? `<img class="image-preview" src="${esc(answer.image)}" alt="Твоё прикреплённое решение"><button class="btn quiet sm" data-action="remove-image">Удалить фотографию</button>` : ''}</div>`}<div class="save-status" id="save-status" role="status">${icon('check')}<span>${ctx.pending.size ? 'Есть несохранённые изменения' : 'Ответы сохранены'}</span></div></div><div class="task-controls"><button class="btn outline" data-action="previous" ${ctx.index === 0 ? 'disabled' : ''}>Предыдущее</button>${ctx.index < ctx.tasks.length - 1 ? '<button class="btn lime" data-action="next">Следующее задание</button>' : '<button class="btn lime" data-action="finish">Завершить пробник</button>'}</div><button class="btn outline full mobile-only mobile-finish" data-action="finish">Завершить пробник</button>`;
  $('#answer').addEventListener('input', event => changed(task.id, { ...ctx.attempt.answers[task.id], text: event.target.value, image: ctx.attempt.answers[task.id]?.image || null }));
  if (task.type === 'written') {
    $('#photo').addEventListener('change', event => { if (event.target.files[0]) void attachImage(event.target.files[0], ctx, task.id); });
    $('#answer').addEventListener('paste', event => { const file = [...event.clipboardData.items].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile(); if (file) { event.preventDefault(); void attachImage(file, ctx, task.id); } });
  }
}
async function attachImage(file, context, taskId) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) return toast('Нужен PNG, JPEG или WebP размером до 8 МБ.');
  try {
    const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Не удалось прочитать фотографию.')); reader.readAsDataURL(file); });
    if (state.context !== context) return;
    changed(taskId, { text: context.attempt.answers[taskId]?.text || '', image });
    taskPanel(); await flush(context);
  } catch (error) { toast(error.message); }
}
async function attemptPage(id) {
  if (!state.user) return login(() => go(`attempt/${id}`));
  const data = await api(`/attempts/${id}`); const { attempt, exam, tasks } = data;
  if (attempt.status === 'complete') return results(attempt, exam, tasks);
  if (attempt.status === 'checking') {
    shell(); state.page = 'checking';
    $('#main').innerHTML = `<div class="wrap page"><div class="checking"><div class="checking-orbit">${icon('spark')}</div><span class="eyebrow muted">Самая сложная часть уже позади</span><h1>СОБИРАЕМ ТВОЙ РЕЗУЛЬТАТ.</h1><p>${state.demo ? 'Сверяем краткие ответы и готовим разбор. Развёрнутые решения отметим для перепроверки.' : 'Проверяем ответы и анализируем решения. Это может занять несколько минут.'}</p><span class="spinner"></span><p class="small">Можно закрыть страницу. Результат сохранится в профиле.</p><a class="btn outline exam-finish" href="#profile">Перейти в профиль</a></div></div>`;
    const renderId = state.renderId; polling = setTimeout(() => { if (state.renderId === renderId) void route(); }, 1500); return;
  }
  state.page = 'exam'; state.context = { attempt, exam, tasks, index: 0, offset: data.serverTime - Date.now(), pending: new Map(), saving: null };
  shell(exam);
  $('#main').innerHTML = `<div class="wrap page"><div class="page-heading"><div><span class="eyebrow muted">${esc(exam.variant)}</span><h1 class="page-title">${esc(exam.title)}</h1></div><a href="#profile" class="btn outline sm">Сохранить и выйти</a></div><div class="exam-layout"><aside class="exam-sidebar" aria-label="Навигация по заданиям"><h3>Твои задания</h3><div class="task-grid">${tasks.map(task => `<button class="task-num ${answered(attempt.answers[task.id]) ? 'answered' : ''}" data-action="task" data-id="${task.id}" aria-label="Задание ${task.id}">${task.id}</button>`).join('')}</div><div class="legend"><i></i>Ответ указан</div><p id="answer-count" class="exam-progress">${Object.values(attempt.answers).filter(answered).length} из ${tasks.length} заданий с ответом</p><p class="field-hint">Таймер продолжает идти после выхода.</p><button class="btn full outline exam-finish" data-action="finish">Завершить пробник</button></aside><section id="task-panel" aria-label="Условие и ответ"></section></div></div>`;
  taskPanel(); updateTimer(); ticking = setInterval(updateTimer, 1000);
}
function updateTimer() {
  const ctx = state.context; if (!ctx || !$('#timer')) return;
  const seconds = Math.max(0, Math.ceil((ctx.attempt.deadline - Date.now() - ctx.offset) / 1000));
  $('#timer span').textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  $('#timer').classList.toggle('warning', seconds < 300);
  if (!seconds) { clearInterval(ticking); ctx.pending.clear(); state.context = null; toast('Время вышло. Проверяем сохранённые ответы.'); void route(); }
}
async function finish() {
  const ctx = state.context; await flush(ctx);
  const count = Object.values(ctx.attempt.answers).filter(answered).length;
  openModal(`<span class="brand-mark">${icon('sheet')}</span><h2 id="modal-title">Завершаем пробник?</h2><p>Ответы указаны в ${count} из ${ctx.tasks.length} заданий. После отправки изменить их будет нельзя.</p><button class="btn lime full" data-action="confirm-finish">Да, отправить на проверку</button><button class="btn quiet full" data-action="close-modal">Вернуться к заданиям</button>`);
}
function results(attempt, exam, tasks) {
  state.page = 'results'; shell(); const result = attempt.result;
  const status = row => row.review ? 'На перепроверке' : row.points === row.maxPoints ? 'Верно' : row.points ? 'Частично верно' : 'Есть ошибка';
  const statusClass = row => row.review ? 'status-review' : row.points === row.maxPoints ? 'status-ok' : 'status-wrong';
  $('#main').innerHTML = `<div class="wrap page"><a class="back" href="#profile">${icon('back')}Мои пробники</a><div class="result-hero"><div><span class="eyebrow">${esc(exam.title)} · ${date(attempt.startedAt)}</span><h1>ЕЩЁ НА ШАГ УВЕРЕННЕЕ.</h1><p>${esc(exam.variant)} · ${result.review ? 'Предварительный результат' : 'Результат учебного пробника'}</p></div><div class="result-metrics"><div><span class="metric-value">${result.points}<small class="small">/${result.maxPoints}</small></span><span class="metric-label">Первичные баллы</span></div><div><span class="metric-value">${result.percent}%</span><span class="metric-label">От максимума</span></div><div><span class="metric-value">${result.grade}</span><span class="metric-label">Прогноз оценки</span></div></div></div>${result.review ? '<div class="notice">Есть решения на перепроверке. Баллы за них пока не включены в сумму. Итоговая оценка может измениться.</div>' : ''}<p class="field-hint">${esc(result.scale)} ${exam.demo ? 'Вариант учебный; прогноз не гарантирует оценку на официальном экзамене.' : ''}</p><h2 class="result-section-title">Твои ответы — по порядку</h2><div class="table-wrap"><table class="results-table"><thead><tr><th scope="col">№</th><th scope="col">Твой ответ</th><th scope="col">Верный ответ</th><th scope="col">Баллы</th><th scope="col">Результат</th></tr></thead><tbody>${result.rows.map(row => { const task = tasks.find(t => t.id === row.taskId); const answer = attempt.answers[task.id]; return `<tr><th scope="row">${task.id}</th><td class="result-answer">${esc(answer?.text || (answer?.image ? 'Фото решения' : 'Нет ответа'))}</td><td class="result-answer">${esc(task.answers[0])}</td><td>${row.review ? '—' : row.points} / ${row.maxPoints}</td><td class="${statusClass(row)}">${status(row)}</td></tr>`; }).join('')}</tbody></table></div><h2 class="result-section-title">Разберём каждое задание</h2>${result.rows.map(row => { const task = tasks.find(t => t.id === row.taskId); const answer = attempt.answers[task.id]; return `<details class="solution"><summary><span>Задание ${task.id} · ${esc(task.topic)}</span><span class="${statusClass(row)}">${status(row)}</span></summary><div class="solution-body"><p>${esc(task.prompt)}</p><div class="solution-label">Твой ответ</div><p>${esc(answer?.text || 'Не указан')}</p>${answer?.image ? `<img class="image-preview" src="${esc(answer.image)}" alt="Твоё решение задания ${task.id}">` : ''}<div class="solution-label">Верное решение</div><p>${esc(task.explanation)}</p><div class="feedback">${esc(row.feedback)}</div></div></details>`; }).join('')}<h2 class="result-section-title">Твой план подготовки</h2>${result.recommendations.length ? `<div class="recommendations">${result.recommendations.map(rec => `<article class="recommendation"><h3>${esc(rec.topic)}</h3><p>${esc(rec.text)}</p></article>`).join('')}</div>` : `<div class="notice">${result.review ? 'Дождись перепроверки развёрнутых решений. В проверенных заданиях ошибок нет.' : 'Все задания выполнены верно. Поддерживай форму: повторяй темы и пробуй новые варианты.'}</div>`}<div class="result-bottom"><a class="btn outline" href="#profile">Все результаты</a><button class="btn lime" data-action="choose" data-id="${exam.id}">${state.demo ? 'Пройти ещё раз' : `Повторить за ${money(Math.round(exam.price * .75))} · −25%`}</button></div></div>`;
}
function legal(type) {
  shell();
  $('#main').innerHTML = `<article class="wrap page legal"><a href="#home" class="back">${icon('back')}На главную</a><h1>${type === 'privacy' ? 'ОБРАБОТКА ДАННЫХ' : 'УСЛОВИЯ ИСПОЛЬЗОВАНИЯ'}</h1><div class="notice">Сервис работает в учебном режиме. Эти сведения описывают текущую демонстрационную версию. Перед коммерческим запуском оператор должен опубликовать собственные реквизиты и утверждённые документы.</div>${type === 'privacy' ? `<h2>Какие данные сохраняются</h2><p>Почта для входа, время согласия, приобретённые доступы, ответы, фотографии решений и результаты. На устройстве используется необходимый для авторизации файл cookie. Аналитические и рекламные cookie не подключены.</p><h2>Для чего нужны данные</h2><p>Для входа в аккаунт, сохранения прогресса и отображения разбора. В локальном учебном режиме письма не отправляются, платежи имитируются, внешняя модель ИИ не вызывается.</p><h2>Передача при подключении сервисов</h2><p>В рабочем режиме почта передаётся SMTP-провайдеру, информация для оплаты и чека — ЮKassa, текст и фотографии решений — провайдеру ИИ. Не указывайте в решениях посторонние персональные данные.</p><h2>Удаление данных</h2><p>Данные локального деморежима хранятся на компьютере оператора в папке .data. В публичной версии оператор обязан указать срок хранения и контакт для запросов на удаление до открытия регистрации.</p>` : `<h2>Учебные материалы</h2><p>Текущие задания авторские и не являются официальными вариантами ФИПИ. Кроме математики, варианты сокращены. Аудирование, устные задания, изложение и лабораторные работы в эту версию не входят.</p><h2>Результат и проверка</h2><p>Оценка служит ориентиром для подготовки. Неуверенные результаты требуют перепроверки. В учебном режиме баллы за приложенные развёрнутые решения не включаются в подтверждённую сумму.</p><h2>Оплата</h2><p>В учебном режиме деньги не списываются. Плановая цена полноценного пробника — 299 ₽, повтор того же варианта после результата — 224,25 ₽. До приёма реальных платежей оператор должен опубликовать оферту, реквизиты, правила возврата и проверить банк заданий.</p><h2>Прохождение</h2><p>Ответы сохраняются после подтверждения сервером. Таймер продолжает идти после закрытия вкладки. После завершения изменить ответы нельзя; разбор остаётся в профиле.</p>`}</article>`;
}
function go(path) { if (location.hash === '#' + path) return route(); location.hash = path; }
async function route() {
  const hash = location.hash.slice(1) || 'home';
  if (['subjects', 'how', 'faq'].includes(hash) && !state.user) {
    if (state.page !== 'landing') landing(); requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView()); return;
  }
  try { await flush(); }
  catch { if (state.context) history.replaceState(null, '', `#attempt/${state.context.attempt.id}`); return; }
  clearTimeout(polling); clearInterval(ticking); state.context = null;
  const renderId = ++state.renderId;
  $('#main').innerHTML = '<div class="loading"><span class="spinner"></span><p>Загружаем…</p></div>';
  const [page, id] = hash.split('/');
  try {
    if (page === 'home') { if (state.user) await catalog(); else landing(); }
    else if (page === 'catalog' || ['subjects','how','faq'].includes(page)) await catalog();
    else if (page === 'profile') { if (state.user) await catalog(true); else { landing(); login(() => go('profile')); } }
    else if (page === 'checkout') await checkout(id);
    else if (page === 'instruction') await instruction(id);
    else if (page === 'attempt') await attemptPage(id);
    else if (page === 'payment') await paymentReturn();
    else if (page === 'privacy' || page === 'terms') legal(page);
    else { if (state.user) await catalog(); else landing(); }
    if (state.renderId === renderId) window.scrollTo(0, 0);
  } catch (error) {
    if (renderId !== state.renderId) return;
    shell(); $('#main').innerHTML = `<div class="wrap connection-error"><h1>НЕ УДАЛОСЬ ЗАГРУЗИТЬ.</h1><p>${esc(error.message)}</p><button class="btn lime" data-action="refresh">Попробовать снова</button></div>`;
    if (error.status === 401) { state.user = null; login(() => route()); }
  }
}
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (event.target.closest('[data-close-modal]')) $('#modal').close();
  if (!target || target.disabled) return;
  const { action, id } = target.dataset;
  try {
    if (action === 'login') login();
    else if (action === 'close-modal') $('#modal').close();
    else if (action === 'choose') { if (state.user) go(`checkout/${id}`); else login(() => go(`checkout/${id}`)); }
    else if (action === 'logout') { await api('/auth/logout', { method: 'POST', data: {} }); state.user = null; state.dashboard = null; go('home'); }
    else if (action === 'filter') { state.category = id; for (const tab of document.querySelectorAll('.tab')) { tab.classList.toggle('active', tab.dataset.id === id); tab.setAttribute('aria-pressed', tab.dataset.id === id); } filterSubjects(); }
    else if (action === 'pay') { target.disabled = true; if (state.demo) { await api(`/orders/${id}/confirm-demo`, { method: 'POST', data: {} }); go(`instruction/${id}`); } else { const url = new URL(target.dataset.url); if (url.protocol !== 'https:') throw new Error('Некорректный адрес оплаты.'); location.assign(url.href); } }
    else if (action === 'start') { target.disabled = true; const result = await api('/attempts', { method: 'POST', data: { orderId: id } }); go(`attempt/${result.attempt.id}`); }
    else if (['task','previous','next'].includes(action)) { await flush(); const ctx = state.context; ctx.index = action === 'task' ? ctx.tasks.findIndex(task => task.id === Number(id)) : ctx.index + (action === 'next' ? 1 : -1); taskPanel(); }
    else if (action === 'remove-image') { const ctx = state.context; const task = ctx.tasks[ctx.index]; changed(task.id, { text: ctx.attempt.answers[task.id]?.text || '', image: null }); taskPanel(); await flush(); }
    else if (action === 'retry-save') await flush();
    else if (action === 'finish') await finish();
    else if (action === 'confirm-finish') { target.disabled = true; await flush(); const ctx = state.context; await api(`/attempts/${ctx.attempt.id}/submit`, { method: 'POST', data: {} }); state.context = null; $('#modal').close(); await route(); }
    else if (action === 'refresh') await route();
  } catch (error) { target.disabled = false; toast(error.message); }
});
window.addEventListener('hashchange', () => void route());
window.addEventListener('beforeunload', event => { if (state.context && (state.context.pending.size || state.context.saving)) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('online', () => { if (state.context?.pending.size) void flush().catch(error => toast(error.message)); });
$('#modal').addEventListener('click', event => { if (event.target === $('#modal')) { const rect = $('#modal').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('#modal').close(); } });
try {
  const [me, catalogData] = await Promise.all([api('/me'), api('/exams')]);
  state.user = me.user; state.demo = me.demo; state.exams = catalogData.exams; await route();
} catch (error) { shell(); $('#main').innerHTML = `<div class="wrap connection-error"><h1>СЕРВЕР НЕДОСТУПЕН.</h1><p>${esc(error.message)}</p><button class="btn lime" data-action="reload">Обновить страницу</button></div>`; document.addEventListener('click', event => { if (event.target.closest('[data-action="reload"]')) location.reload(); }); }
