'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./chat-engine.cjs');
const F = require('./finance.js');
const {DatabaseSync} = require('node:sqlite');
const {createChatService} = require('./chat-service.cjs');
const options = {today:'2026-09-15',expenseId:'test-expense'};
const send = (text,previous) => E.handleMessage(text,previous?.state || {},previous?.data || E.blank(),options);

test('chat registers Pix and preserves structured payment through backups and entries', () => {
  const result = send('Gastei 85,90 no mercado via Pix');
  assert.equal(result.changed,true);
  const expense = result.data.expenses[0];
  assert.equal(expense.totalCents,8590); assert.equal(expense.category,'mercado');
  assert.equal(expense.paymentMethod,'pix'); assert.equal(expense.date,'2026-09-15');
  assert.equal(F.validateBackup(result.data).expenses[0].paymentMethod,'pix');
  assert.equal(F.buildEntries(result.data.expenses)[0].paymentMethod,'pix');
});

test('total price and per-installment price differ, dates clamp and cents are preserved', () => {
  const total = send('Comprei um tênis por 100 no crédito em 3 vezes, categoria Online, primeira parcela em 31/01/2026');
  assert.equal(total.changed,true);
  const entries = F.buildEntries(total.data.expenses);
  assert.deepEqual(entries.map(e => e.amountCents),[3334,3333,3333]);
  assert.deepEqual(entries.map(e => e.date),['2026-01-31','2026-02-28','2026-03-31']);
  const per = send('Comprei um tênis em 3 vezes de 100, categoria Online');
  assert.equal(per.data.expenses[0].totalCents,30000);
  const later = send('Comprei tênis por 300 em 3 vezes categoria Online primeira parcela em dezembro de 2026');
  assert.deepEqual(F.buildEntries(later.data.expenses).map(e => e.month),['2026-12','2027-01','2027-02']);
});

test('credit starts next month, including single payments, year changes and short months', () => {
  const single = send('Gastei 100 no mercado no crédito');
  assert.equal(single.data.expenses[0].date,'2026-10-15');
  assert.equal(F.entriesForMonth(single.data.expenses,'2026-09').length,0);
  assert.equal(F.entriesForMonth(single.data.expenses,'2026-10')[0].amountCents,10000);
  for (const [date,expected] of [['31/01/2026','2026-02-28'],['31/01/2028','2028-02-29'],['31/12/2026','2027-01-31']]) {
    const result = send(`Comprei tênis por 300 no crédito em 3 vezes, categoria Online, em ${date}`);
    assert.equal(result.data.expenses[0].date,expected);
    assert.equal(F.buildEntries(result.data.expenses).length,3);
  }
  for (const method of ['Pix','débito','dinheiro','boleto']) assert.equal(send(`Gastei 100 no mercado via ${method}`).data.expenses[0].date,'2026-09-15');
});

test('explicit first bill dates override credit default and follow-up questions do not shift again', () => {
  for (const label of ['primeira parcela','primeira fatura','vencimento']) {
    const result = send(`Comprei tênis por 300 no crédito em 3 vezes, categoria Online, ${label} em 20/11/2026`);
    assert.equal(result.data.expenses[0].date,'2026-11-20');
  }
  let pending = send('Comprei tênis por 300 no crédito em 3 vezes');
  assert.equal(pending.state.pending.draft.date,'2026-10-15');
  const result = send('Online',pending);
  assert.equal(result.data.expenses[0].date,'2026-10-15');
  assert.equal(send('Corrigir último gasto: pagamento crédito',result).data.expenses[0].date,'2026-10-15');
  let pix = send('Gastei 100 no mercado via Pix');
  pix = send('Corrigir último gasto: pagamento crédito',pix);
  assert.equal(pix.data.expenses[0].date,'2026-10-15');
  pix = send('Corrigir último gasto: valor 120',pix);
  assert.equal(pix.data.expenses[0].date,'2026-10-15');
});

test('missing details stay pending across calls, unknown categories can be created, and cancel has no financial effect', () => {
  let result = send('Comprei um celular por 2.400 em 10 vezes');
  assert.equal(result.changed,false); assert.equal(result.state.pending.field,'category');
  const attemptedNewPurchase = send('Gastei 100 no mercado',result);
  assert.equal(attemptedNewPurchase.changed,false); assert.equal(attemptedNewPurchase.state.pending.draft.totalCents,240000);
  result = send('Online',result);
  assert.equal(result.data.expenses[0].totalCents,240000); assert.equal(result.data.expenses[0].installments,10);
  let custom = send('Paguei 50 de ônibus');
  custom = send('criar categoria Transporte',custom);
  assert.equal(custom.changed,true); assert.equal(custom.data.customCategories[0].label,'Transporte');
  assert.equal(custom.data.expenses[0].category,custom.data.customCategories[0].id);
  let unknown = send('Gastei no mercado');
  assert.equal(unknown.state.pending.field,'amount');
  unknown = send('45,60',unknown); assert.equal(unknown.changed,true);
  let installments = send('Comprei tênis por 300 parcelado categoria Online');
  assert.equal(installments.state.pending.field,'installments');
  installments = send('3',installments); assert.equal(installments.data.expenses[0].installments,3);
  const canceled = send('cancelar',send('Comprei um celular por 100'));
  assert.equal(canceled.state.pending,undefined); assert.equal(canceled.data.expenses.length,0);
});

test('invalid and ambiguous messages cannot partially mutate financial data', () => {
  for (const text of ['Gastei -100 no mercado','Gastei 100 no mercado e 200 no cinema','Comprei em 121 vezes de 1 categoria Online','Comprei por 100 em 31/02/2026 categoria Online','Gastei US$ 100 no mercado','Gastei 100 no mercado via Pix e crédito','Não gastei 100 no mercado','Gastei 100 no mercado amanhã']) {
    const result = send(text);
    assert.equal(result.changed,false,text); assert.equal(result.data.expenses.length,0,text);
  }
});

test('correction and undo affect only the last chat operation and refuse external edits', () => {
  let result = send('Gastei 85,90 no mercado via Pix');
  result = send('Corrigir último gasto: valor 90',result);
  assert.equal(result.data.expenses[0].totalCents,9000);
  assert.equal(result.data.expenses[0].paymentMethod,'pix');
  result = send('Desfazer último gasto',result);
  assert.equal(result.data.expenses[0].totalCents,8590);
  assert.equal(send('Desfazer último gasto',result).changed,false);
  let fresh = send('Gastei 100 no mercado');
  fresh.data.expenses[0].name = 'Alterado no painel';
  assert.equal(send('Desfazer último gasto',fresh).changed,false);
  assert.equal(send('Desfazer último gasto',send('Gastei 100 no mercado')).data.expenses.length,0);
});

test('reports read actual monthly installments and category totals, never fabricated answers', () => {
  const result = send('Comprei tênis por 100 em 3 vezes categoria Online primeira parcela em outubro');
  const report = send('Relatório de novembro de 2026',result);
  assert.equal(report.changed,false); assert.equal(report.report.totalCents,3333);
  assert.equal(report.report.month,'2026-11');
  assert.equal(send('Quanto gastei com mercado este mês?',result).report.totalCents,0);
  assert.equal(send('Relatório de 2026-10',result).report.totalCents,3334);
  assert.equal(send('Relatório do ano',result).report,undefined);
  assert.equal(send('Quanto gastei com transporte?',result).report,undefined);
});

function serviceFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('alice'),('bob');
    CREATE TABLE account_data (user_id TEXT PRIMARY KEY,payload TEXT,revision INTEGER,updated_at INTEGER); INSERT INTO account_data VALUES ('alice',NULL,0,0),('bob',NULL,0,0);`);
  return {db,service:createChatService(db)};
}

test('message idempotency, conversation concurrency and account isolation are transactional', t => {
  const {db,service} = serviceFixture(); t.after(() => db.close());
  const body = {text:'Gastei 85,90 no mercado via Pix',messageId:'message-12345',revision:0,chatRevision:0};
  const first = service.send('alice',body);
  assert.equal(first.changed,true); assert.equal(first.revision,1);
  assert.deepEqual(service.send('alice',body),first);
  assert.equal(JSON.parse(db.prepare('SELECT payload FROM account_data WHERE user_id=?').get('alice').payload).expenses.length,1);
  assert.deepEqual(service.get('bob'),{history:[],chatRevision:0});
  assert.throws(() => service.send('alice',{...body,text:'Gastei 100 no mercado'}),e => e.status === 409);
  assert.throws(() => service.send('alice',{...body,messageId:'message-54321'}),e => e.status === 409);
  const next = service.send('bob',body); assert.equal(next.changed,true);
  assert.equal(service.get('alice').history.length,2);
});

test('server revision conflicts preserve pending conversation and do not lose dashboard data', t => {
  const {db,service} = serviceFixture(); t.after(() => db.close());
  service.send('alice',{text:'Comprei um celular por 100',messageId:'pending-12345',revision:0,chatRevision:0});
  db.prepare('UPDATE account_data SET payload=?,revision=1 WHERE user_id=?').run(JSON.stringify({...E.blank(),budgets:{'2026-09':10000}}),'alice');
  assert.throws(() => service.send('alice',{text:'Online',messageId:'category-12345',revision:0,chatRevision:1}),e => e.status === 409);
  const result = service.send('alice',{text:'Online',messageId:'category-12345',revision:1,chatRevision:1});
  assert.equal(result.changed,true);
  assert.equal(JSON.parse(db.prepare('SELECT payload FROM account_data WHERE user_id=?').get('alice').payload).budgets['2026-09'],10000);
});
