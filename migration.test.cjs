'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { databasePath } = require('./migrate-database.cjs');
function storage(entries = []) {
  const map = new Map(entries);
  return {get length() {return map.size;}, key: i => [...map.keys()][i], getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k)};
}
test('database migration preserves WAL records and never replaces an existing target', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneyrestly-migration-'));
  const old = new DatabaseSync(path.join(dir,'finanto.sqlite'));
  try {
    old.exec("PRAGMA journal_mode=WAL; CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('preserved');");
    const dest = databasePath(dir, {});
    const db = new DatabaseSync(dest);
    try {
      assert.equal(db.prepare('SELECT value FROM sample').get().value,'preserved');
      db.exec("INSERT INTO sample VALUES ('new');");
      assert.equal(databasePath(dir, {}),dest);
      assert.equal(db.prepare('SELECT count(*) AS n FROM sample').get().n,2);
    } finally {db.close();}
    assert.throws(() => databasePath(dir, {FINANTO_DB:'old.sqlite'}), /MONEYRESTLY_DB/);
  } finally {old.close(); fs.rmSync(dir,{recursive:true,force:true});}
});
test('browser migration preserves pending changes, pointers, chat retries and conflicts', () => {
  const local = storage([['finanto.account.a.data.v1.pending.123','pending'],['finanto.data.v1','backup'],['finanto.account.b.demo.v1','old'],['moneyrestly.account.b.demo.v1','new']]);
  const session = storage([['finanto.account.a.data.v1.pending-pointer','finanto.account.a.data.v1.pending.123'],['orcaviva.chat.pending.a','retry']]);
  const context = {window:{localStorage:local,sessionStorage:session}};
  const script = fs.readFileSync(path.join(__dirname,'migrate-storage.js'),'utf8');
  vm.runInNewContext(script,context);
  assert.equal(local.getItem('moneyrestly.account.a.data.v1.pending.123'),'pending');
  assert.equal(session.getItem('moneyrestly.account.a.data.v1.pending-pointer'),'moneyrestly.account.a.data.v1.pending.123');
  assert.equal(session.getItem('moneyrestly.chat.pending.a'),'retry');
  assert.equal(local.getItem('moneyrestly.data.v1'),'backup');
  assert.equal(local.getItem('moneyrestly.account.b.demo.v1'),'new');
  assert.equal(local.getItem('finanto.account.b.demo.v1'),'old');
  local.removeItem('moneyrestly.account.a.data.v1.pending.123');
  vm.runInNewContext(script,context);
  assert.equal(local.getItem('moneyrestly.account.a.data.v1.pending.123'),null);
});
