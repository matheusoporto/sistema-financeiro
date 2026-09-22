'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createMailer } = require('./mailer.cjs');
(async () => {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const mailer = createMailer();
  if (!mailer) throw new Error('Preencha SMTP_HOST, SMTP_USER, SMTP_PASS e MAIL_FROM no arquivo .env.');
  await mailer.verify();
  console.log('Conexão e autenticação SMTP verificadas. Nenhum e-mail foi enviado.');
})().catch(error => {
  const knownCodes = new Set(['EAUTH','ECONNECTION','ETIMEDOUT','ESOCKET','EDNS']);
  console.error(error.code ? `Não foi possível validar o SMTP (${knownCodes.has(error.code) ? error.code : 'erro de conexão'}). Confira a configuração e a senha de app.` : error.message);
  process.exitCode = 1;
});
