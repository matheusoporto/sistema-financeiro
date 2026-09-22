'use strict';
const nodemailer = require('nodemailer');

function createMailer(env = process.env) {
  const fields = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];
  if (!fields.every(field => env[field])) return null;
  const port = Number(env.SMTP_PORT || 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT inválida.');
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    tls: { minVersion: 'TLSv1.2' },
    disableFileAccess: true, disableUrlAccess: true
  });
  return {
    verify: () => transporter.verify(),
    sendReset: ({ email, url }) => transporter.sendMail({
      from: env.MAIL_FROM, to: { address: email, name: '' },
      subject: 'Redefina sua senha — Orçaviva',
      text: `Recebemos um pedido para redefinir sua senha no Orçaviva.\n\nAbra este link em até 30 minutos:\n${url}\n\nO link pode ser usado uma única vez. Se você não pediu esta alteração, ignore este e-mail. Sua senha continua a mesma.\n\nOrçaviva — Mais clareza para os seus próximos planos.`
    })
  };
}

module.exports = { createMailer };
