'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {createChatService} = require('./chat-service.cjs');
const {createTelegram,telegramConfig} = require('./telegram.cjs');
const config = {token:'123:fake',username:'moneyrestly_test_bot',secret:'s'.repeat(32)};
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('alice'),('bob');
    CREATE TABLE account_data(user_id TEXT PRIMARY KEY REFERENCES users(id),payload TEXT,revision INTEGER,updated_at INTEGER);
    INSERT INTO account_data VALUES ('alice',NULL,0,0),('bob',NULL,0,0);`);
  let clock = Date.UTC(2026,9,3), fail = false;
  const sent = [], chat = createChatService(db);
  const api = async (_,method,body) => {if(fail) throw Error('offline'); sent.push({method,...body});};
  const make = () => createTelegram(db,chat,config,()=>clock,api);
  const bot = make();
  const update = (id,text,sender=11) => ({update_id:id,message:{date:Math.floor(clock/1000),message_id:id,chat:{type:'private',id:sender},from:{id:sender,is_bot:false},text}});
  const token = user => new URL(bot.connect(user).url).searchParams.get('start');
  return {db,bot,make,sent,token,update,advance:ms=>clock+=ms,fail:value=>fail=value};
}
test('Telegram config is disabled by default and rejects partial or malformed secrets',()=>{
  assert.equal(telegramConfig({}),null);
  assert.throws(()=>telegramConfig({TELEGRAM_BOT_TOKEN:'123:fake'}));
  assert.equal(telegramConfig({TELEGRAM_BOT_TOKEN:config.token,TELEGRAM_BOT_USERNAME:config.username,TELEGRAM_WEBHOOK_SECRET:config.secret}).username,config.username);
});
test('link codes are hashed, expiring, single-use, regenerated and account-isolated',async t=>{
  const s=setup(); t.after(()=>s.db.close());
  const expired=s.token('alice'); s.advance(600001);
  await s.bot.receive(s.update(1,'/start '+expired)); assert.equal(s.bot.status('alice').linked,false);
  const replaced=s.token('alice'), valid=s.token('alice');
  assert.notEqual(s.db.prepare('SELECT token_hash FROM telegram_tokens').get().token_hash,valid);
  await s.bot.receive(s.update(2,'/start '+replaced)); assert.equal(s.bot.status('alice').linked,false);
  await s.bot.receive(s.update(3,'/start '+valid)); assert.equal(s.bot.status('alice').linked,true);
  await s.bot.receive(s.update(4,'/start '+valid,22)); assert.equal(s.db.prepare('SELECT telegram_id FROM telegram_links').get().telegram_id,'11');
  await s.bot.receive(s.update(5,'/start '+s.token('bob'))); assert.equal(s.bot.status('bob').linked,false);
  s.bot.disconnect('alice'); assert.equal(s.bot.status('alice').linked,false);
  const other=s.token('bob'); await s.bot.receive(s.update(6,'/start '+other)); assert.equal(s.bot.status('bob').linked,true);
});
test('expenses and reports reuse chat; retries, restarts and send failures never duplicate expenses',async t=>{
  const s=setup();t.after(()=>s.db.close());
  await s.bot.receive(s.update(1,'/start '+s.token('alice')));
  const purchase=s.update(2,'Gastei 85,90 no mercado via Pix');
  s.fail(true);await assert.rejects(s.bot.receive(purchase));
  const data=()=>JSON.parse(s.db.prepare("SELECT payload FROM account_data WHERE user_id='alice'").get().payload);
  assert.equal(data().expenses.length,1);
  s.fail(false);await s.make().receive(purchase);await s.bot.receive(purchase);
  assert.equal(data().expenses.length,1);assert.equal(s.sent.length,2);
  await s.bot.receive(s.update(3,'relatório deste mês'));assert.match(s.sent.at(-1).text,/85,90/);
  assert.equal(s.db.prepare("SELECT payload FROM account_data WHERE user_id='bob'").get().payload,null);
  for(let i=4;i<106;i++) await s.bot.receive(s.update(i,'ajuda'));
  await s.bot.receive(purchase);assert.equal(data().expenses.length,1);
  await s.bot.receive(s.update(200,'Gastei 20 no mercado via Pix',22));assert.equal(data().expenses.length,1);
});
test('Telegram defines, clarifies and undoes monthly budgets without duplicate or cross-account writes',async t=>{
  const s=setup();t.after(()=>s.db.close());
  await s.bot.receive(s.update(1,'/start '+s.token('alice')));
  await s.bot.receive(s.update(2,'Definir orçamento de novembro'));
  const value=s.update(3,'3500');
  await s.bot.receive(value);await s.bot.receive(value);
  const data=()=>JSON.parse(s.db.prepare("SELECT payload FROM account_data WHERE user_id='alice'").get().payload);
  assert.equal(data().budgets['2026-11'],350000);assert.deepEqual(data().expenses,[]);
  await s.bot.receive(s.update(4,'Recebi 4000 em novembro'));
  assert.equal(data().budgets['2026-11'],400000);
  await s.bot.receive(s.update(5,'desfazer orçamento'));
  assert.equal(data().budgets['2026-11'],350000);
  assert.equal(s.db.prepare("SELECT payload FROM account_data WHERE user_id='bob'").get().payload,null);
});

test('groups, edited updates and invalid senders are ignored; unlink cancels pending replies',async t=>{
  const s=setup();t.after(()=>s.db.close());const token=s.token('alice');
  const group=s.update(1,'/start '+token);group.message.chat.type='group';
  await s.bot.receive(group);assert.equal(s.bot.status('alice').linked,false);assert.equal(s.sent.length,0);
  await s.bot.receive({update_id:2,edited_message:s.update(2,'/start '+token).message});assert.equal(s.sent.length,0);
  await s.bot.receive(s.update(3,'/start '+token));
  s.fail(true);const purchase=s.update(4,'Gastei 10 no mercado via Pix');await assert.rejects(s.bot.receive(purchase));
  s.bot.disconnect('alice');s.fail(false);await s.bot.receive(purchase);assert.equal(s.sent.length,1);
  await s.bot.receive(s.update(5,'relatório deste mês'));assert.match(s.sent.at(-1).text,/vincular/);
});
