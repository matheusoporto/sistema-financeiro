'use strict';
const {randomBytes, createHash} = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');

function telegramConfig(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const username = env.TELEGRAM_BOT_USERNAME;
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!token && !username && !secret) return null;
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token || '') || !/^[A-Za-z0-9_]{5,32}$/.test(username || '') || !/^[A-Za-z0-9_-]{32,256}$/.test(secret || '')) {
    throw new Error('Configure TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME (sem @) e TELEGRAM_WEBHOOK_SECRET (32 a 256 caracteres).');
  }
  return {token, username, secret};
}
async function telegramAPI(config, method, body) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(10000)
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error();
    return payload.result;
  } catch { throw new Error('Não foi possível comunicar com o Telegram. Confira as configurações e tente novamente.'); }
}

function createTelegram(db, chat, config, now = Date.now, api = telegramAPI) {
  db.exec(`CREATE TABLE IF NOT EXISTS telegram_links (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    telegram_id TEXT UNIQUE NOT NULL, linked_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS telegram_tokens (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS telegram_updates (
    update_id INTEGER PRIMARY KEY, user_id TEXT, chat_id TEXT NOT NULL,
    reply TEXT, delivered INTEGER NOT NULL DEFAULT 0);`);
  const linked = id => db.prepare('SELECT * FROM telegram_links WHERE user_id=?').get(id);
  function status(id) { return {enabled:!!config, linked:!!linked(id)}; }
  function connect(id) {
    if (!config) throw Object.assign(new Error('Telegram ainda não configurado no servidor.'),{status:503});
    if (linked(id)) throw Object.assign(new Error('Desvincule o Telegram atual antes de conectar outro.'),{status:409});
    const token = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM telegram_tokens WHERE expires_at<=?').run(now());
    db.prepare('INSERT INTO telegram_tokens VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at').run(id,hash(token),now()+10*60*1000);
    return {url:`https://t.me/${config.username}?start=${token}`,expiresIn:600};
  }
  function disconnect(id) {
    db.prepare('DELETE FROM telegram_tokens WHERE user_id=?').run(id);
    db.prepare('DELETE FROM telegram_links WHERE user_id=?').run(id);
    db.prepare('UPDATE telegram_updates SET reply=NULL,delivered=1 WHERE user_id=?').run(id);
    return status(id);
  }
  function process(update) {
    if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) return null;
    const previous = db.prepare('SELECT * FROM telegram_updates WHERE update_id=?').get(update.update_id);
    if (previous) return previous;
    const m = update.message;
    if (!m || m.chat?.type !== 'private' || m.from?.is_bot || !Number.isSafeInteger(m.from?.id) || m.from.id <= 0 || m.chat.id !== m.from.id) return null;
    const telegramId = String(m.from.id);
    const text = typeof m.text === 'string' ? m.text.trim() : '';
    let user = db.prepare('SELECT user_id FROM telegram_links WHERE telegram_id=?').get(telegramId)?.user_id || null;
    let reply;
    db.exec('BEGIN IMMEDIATE');
    try {
      const start = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{43})$/);
      if (start) {
        const token = db.prepare('SELECT * FROM telegram_tokens WHERE token_hash=? AND expires_at>?').get(hash(start[1]),now());
        if (!token) reply = 'Este link expirou ou já foi usado. Gere outro em Conectar Telegram no MoneyRestly.';
        else if ((user && user !== token.user_id) || (linked(token.user_id) && linked(token.user_id).telegram_id !== telegramId)) reply = 'Já existe uma vinculação. Desconecte a conta atual pelo site antes de conectar outra.';
        else {
          user = token.user_id;
          db.prepare('INSERT OR IGNORE INTO telegram_links VALUES (?,?,?)').run(user,telegramId,now());
          db.prepare('DELETE FROM telegram_tokens WHERE user_id=?').run(user);
          reply = 'Telegram conectado ao MoneyRestly! Envie: Gastei 85,90 no mercado via Pix. Você também pode pedir relatório deste mês ou desfazer.';
        }
      } else if (!user) reply = 'Entre na sua conta MoneyRestly e selecione Conectar Telegram para vincular este chat.';
      else if (text === '/start' || text === '/help') reply = 'Envie um gasto, por exemplo: Comprei um celular por 1200 no crédito em 6 parcelas, categoria Online. Ou peça: relatório deste mês. Para definir o orçamento, envie: Recebi 3000 este mês. Esse valor substitui o total do mês. Para desconectar, use o menu Telegram no site.';
      else if (!text || text.length > 1000) reply = 'Por enquanto, envie mensagens de texto com até 1.000 caracteres. Áudios, fotos e arquivos ainda não são interpretados.';
      else {
        const account = db.prepare('SELECT revision FROM account_data WHERE user_id=?').get(user);
        const result = chat.send(user,{text,messageId:`telegram_update_${update.update_id}`,revision:account.revision,chatRevision:chat.get(user).chatRevision},now());
        reply = result.history.at(-1).text;
      }
      db.prepare('INSERT INTO telegram_updates(update_id,user_id,chat_id,reply) VALUES (?,?,?,?)').run(update.update_id,user,telegramId,reply);
      db.exec('COMMIT');
      return db.prepare('SELECT * FROM telegram_updates WHERE update_id=?').get(update.update_id);
    } catch (error) {db.exec('ROLLBACK'); throw error;}
  }
  // Serialize deliveries so simultaneous webhook retries cannot send twice in this process.
  let queue = Promise.resolve();
  function receive(update) {
    const task = queue.then(async () => {
      const row = process(update);
      if (!row || row.delivered) return;
      if (row.user_id && linked(row.user_id)?.telegram_id !== row.chat_id) {
        db.prepare('UPDATE telegram_updates SET delivered=1,reply=NULL WHERE update_id=?').run(row.update_id);
        return;
      }
      await api(config,'sendMessage',{chat_id:row.chat_id,text:row.reply.slice(0,4000)});
      db.prepare('UPDATE telegram_updates SET delivered=1,reply=NULL WHERE update_id=?').run(row.update_id);
    });
    queue = task.catch(() => {});
    return task;
  }
  return {status,connect,disconnect,receive};
}
module.exports = {telegramConfig,telegramAPI,createTelegram};
