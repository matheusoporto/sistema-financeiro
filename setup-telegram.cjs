'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {telegramConfig,telegramAPI} = require('./telegram.cjs');
async function main() {
  const env = path.join(__dirname,'.env');
  if (fs.existsSync(env)) process.loadEnvFile(env);
  const config = telegramConfig();
  if (!config) throw new Error('Configure as três variáveis TELEGRAM no ambiente.');
  const origin = new URL(process.env.PUBLIC_ORIGIN);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.origin !== process.env.PUBLIC_ORIGIN) throw new Error('PUBLIC_ORIGIN precisa ser a origem HTTPS, sem barra final.');
  const bot = await telegramAPI(config,'getMe',{});
  if (bot.username.toLowerCase() !== config.username.toLowerCase()) throw new Error('TELEGRAM_BOT_USERNAME não corresponde ao token.');
  const url = origin.origin+'/api/telegram/webhook';
  await telegramAPI(config,'setWebhook',{url,secret_token:config.secret,allowed_updates:['message'],max_connections:1,drop_pending_updates:false});
  const info = await telegramAPI(config,'getWebhookInfo',{});
  if (info.url !== url) throw new Error('O endereço do webhook não foi confirmado.');
  console.log('Webhook configurado: '+url);
  console.log('Abra sua conta no site, selecione Conectar Telegram e inicie a conversa pelo link.');
}
main().catch(() => {console.error('Não foi possível configurar o webhook. Confira PUBLIC_ORIGIN, as variáveis TELEGRAM, o nome do bot e a conexão. Nenhum segredo foi exibido.');process.exitCode=1;});
