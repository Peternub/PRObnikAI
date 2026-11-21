export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  url: process.env.APP_URL || 'http://localhost:3000',
  demo: process.env.DEMO_MODE !== 'false',
  databaseUrl: process.env.DATABASE_URL,
};

if (!config.demo && (!config.databaseUrl || !process.env.SMTP_HOST || !config.url.startsWith('https://'))) {
  throw new Error('Рабочий режим требует DATABASE_URL, SMTP_HOST и APP_URL с HTTPS.');
}
if (config.demo && !['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
  throw new Error('Деморежим разрешён только на локальном интерфейсе.');
}
