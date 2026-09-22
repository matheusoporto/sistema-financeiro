'use strict';
const {createHash, randomUUID} = require('node:crypto');
const F = require('./finance.js');
const engine = require('./chat-engine.cjs');

// Channel-independent application service. Future adapters must authenticate their
// sender and resolve a user ID before calling this service; text cannot select an account.
function createChatService(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_conversations (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL, history TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
  ); CREATE TABLE IF NOT EXISTS chat_receipts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL,
    PRIMARY KEY(user_id,message_id)
  );`);
  const conversation = db.prepare('SELECT * FROM chat_conversations WHERE user_id = ?');
  const account = db.prepare('SELECT payload,revision FROM account_data WHERE user_id = ?');
  const receipt = db.prepare('SELECT * FROM chat_receipts WHERE user_id = ? AND message_id = ?');
  const fail = (status,message) => Object.assign(new Error(message),{status});
  function get(userId) {
    const row = conversation.get(userId);
    return {history:row ? JSON.parse(row.history) : [], chatRevision:row?.revision || 0};
  }
  function send(userId, body, timestamp = Date.now()) {
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1000 ||
      typeof body.messageId !== 'string' || !/^[a-zA-Z0-9_-]{10,100}$/.test(body.messageId) ||
      !Number.isSafeInteger(body.revision) || body.revision < 0 || !Number.isSafeInteger(body.chatRevision) || body.chatRevision < 0) throw fail(400,'A mensagem é inválida. Use até 1.000 caracteres.');
    const requestHash = createHash('sha256').update(body.text).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = receipt.get(userId,body.messageId);
      if (previous) {
        if (previous.request_hash !== requestHash) throw fail(409,'Este identificador já foi utilizado por outra mensagem. Atualize a conversa.');
        db.exec('COMMIT'); return JSON.parse(previous.response);
      }
      const row = conversation.get(userId);
      const current = account.get(userId);
      if (!current) throw fail(401,'Entre na sua conta para continuar.');
      if (current.revision !== body.revision || (row?.revision || 0) !== body.chatRevision) throw fail(409,'A conta ou a conversa mudou. Atualize o chat e envie novamente.');
      const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp));
      const result = engine.handleMessage(body.text,row ? JSON.parse(row.state) : {},current.payload ? JSON.parse(current.payload) : engine.blank(),{today,expenseId:randomUUID()});
      if (result.changed) {
        const payload = JSON.stringify(F.validateBackup(result.data));
        if (Buffer.byteLength(payload) > 8 * 1024 * 1024 - 1024) throw fail(400,'Sua conta atingiu o limite de armazenamento. Exporte um backup e revise seus gastos.');
        db.prepare('UPDATE account_data SET payload = ?,revision = revision + 1,updated_at = ? WHERE user_id = ?').run(payload,timestamp,userId);
      }
      const history = [...(row ? JSON.parse(row.history) : []),{role:'user',text:body.text},{role:'assistant',text:result.reply,...(result.report ? {report:result.report} : {}),actions:result.actions || []}].slice(-40);
      const chatRevision = (row?.revision || 0)+1;
      db.prepare(`INSERT INTO chat_conversations VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,history=excluded.history,revision=excluded.revision`).run(userId,JSON.stringify(result.state),JSON.stringify(history),chatRevision);
      const response = {history,chatRevision,changed:result.changed,revision:current.revision+(result.changed ? 1 : 0)};
      db.prepare('INSERT INTO chat_receipts VALUES (?,?,?,?)').run(userId,body.messageId,requestHash,JSON.stringify(response));
      db.prepare('DELETE FROM chat_receipts WHERE user_id = ? AND rowid NOT IN (SELECT rowid FROM chat_receipts WHERE user_id = ? ORDER BY rowid DESC LIMIT 100)').run(userId,userId);
      db.exec('COMMIT'); return response;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {get,send};
}
module.exports = {createChatService};
