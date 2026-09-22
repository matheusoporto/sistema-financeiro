'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const { createMailer } = require('./mailer.cjs');

test('SMTP requires configuration and TLS; recovery message contains only the intended recipient and link', async t => {
  assert.equal(createMailer({}), null);
  assert.equal(createMailer({ SMTP_HOST: 'smtp.example.com' }), null);
  let config, message;
  t.mock.method(nodemailer, 'createTransport', options => {
    config = options;
    return { verify: async () => true, sendMail: async data => { message = data; return { accepted: [data.to.address] }; } };
  });
  const env = { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'sender@example.com', SMTP_PASS: 'test-app-password', MAIL_FROM: 'sender@example.com' };
  const mailer = createMailer(env);
  assert.equal(config.secure, true);
  assert.equal(config.port, 465);
  assert.equal(config.tls.minVersion, 'TLSv1.2');
  assert.equal(config.disableFileAccess, true);
  assert.equal(config.disableUrlAccess, true);
  assert.equal(await mailer.verify(), true);
  await mailer.sendReset({ email: 'recipient@example.com', url: 'https://app.example/#reset=test-token' });
  assert.equal(message.to.address, 'recipient@example.com');
  assert.equal(message.from, env.MAIL_FROM);
  assert.match(message.text, /https:\/\/app\.example\/#reset=test-token/);
  assert.match(message.text, /30 minutos/);
  assert.ok(!message.text.includes(env.SMTP_PASS));
  createMailer({ ...env, SMTP_PORT: '587' });
  assert.equal(config.secure, false);
  assert.equal(config.requireTLS, true);
  assert.throws(() => createMailer({ ...env, SMTP_PORT: 'invalid' }), /SMTP_PORT/);
});
