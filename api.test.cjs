'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {randomFillSync} = require('node:crypto');
const sources = ['finance.js','api.js'].map(file => fs.readFileSync(path.join(__dirname,file),'utf8'));
const empty = (amount = 0) => ({version:1,expenses:[],customCategories:[],budgets:{'2026-01':amount},preferences:{}});
function storage(map = new Map()) {
  return {get length() { return map.size; },key:index => [...map.keys()][index],getItem:key => map.get(key) ?? null,setItem:(key,value) => map.set(key,String(value)),removeItem:key => map.delete(key),map};
}
function client(remote,local = storage(),session = storage()) {
  const context = vm.createContext({localStorage:local,sessionStorage:session,crypto:{getRandomValues:randomFillSync},AbortSignal,setTimeout:() => 1,clearTimeout:() => {},Date,console});
  context.window = context;
  const json = value => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`,context);
  context.fetch = async (url,options) => {
    const result = await remote(url,options);
    return {ok:result.status < 400,status:result.status,json:async () => json(result.body)};
  };
  sources.forEach(source => vm.runInContext(source,context));
  return {api:context.FinantoAPI,local,session,json};
}
function service() {
  const server = {data:empty(),revision:0,offline:false,calls:[]};
  server.fetch = async (url,options) => {
    server.calls.push({url,options});
    if (server.offline) throw new Error('Offline');
    if (url === '/api/session') return {status:200,body:{user:{id:'alice'},csrfToken:'new-token'}};
    if (options.method === 'PUT') {
      const payload = JSON.parse(options.body);
      if (payload.revision !== server.revision) return {status:409,body:{data:server.data,revision:server.revision,error:'Conflict'}};
      server.data = payload.data; server.revision++;
      return {status:200,body:{revision:server.revision}};
    }
    return {status:200,body:{data:server.data,revision:server.revision}};
  };
  return server;
}
test('concurrent tabs preserve different pending changes through conflict and reload',async () => {
  const server = service(), shared = storage();
  const a = client(server.fetch,shared), b = client(server.fetch,shared);
  const sa = new a.api.AccountStore('alice'), sb = new b.api.AccountStore('alice');
  await sa.load(); await sb.load();
  sa.save(empty(100)); sb.save(empty(200));
  await sa.flush();
  await assert.rejects(sb.flush(),error => error.status === 409);
  assert.equal(server.data.budgets['2026-01'],100);
  assert.equal(JSON.parse(shared.getItem(sb.pendingKey)).data.budgets['2026-01'],200);
  sa.save(empty(300)); await sa.flush();
  const reloaded = client(server.fetch,shared,b.session);
  const next = new reloaded.api.AccountStore('alice');
  const recovered = await next.load();
  assert.equal(recovered.budgets['2026-01'],200);
  assert.equal(next.conflict,true);
  sb.close(); next.close(); sa.close();
});
test('offline pending data resumes on reload and is isolated by account',async () => {
  const server = service(), shared = storage(), tab = storage();
  const a = client(server.fetch,shared,tab), store = new a.api.AccountStore('alice');
  await store.load(); server.offline = true; store.save(empty(450));
  await assert.rejects(store.flush()); store.close(); server.offline = false;
  const b = client(server.fetch,shared,tab), resumed = new b.api.AccountStore('alice');
  assert.equal((await resumed.load()).budgets['2026-01'],450);
  await resumed.flush();
  assert.equal(server.data.budgets['2026-01'],450);
  assert.equal(shared.getItem(resumed.pendingKey),null);
  const otherServer = service(), other = client(otherServer.fetch,shared), bob = new other.api.AccountStore('bob');
  assert.equal((await bob.load()).budgets['2026-01'],0);
  resumed.close(); bob.close();
});
test('expired CSRF is renewed once for the same account, never for another account',async () => {
  let calls = 0, account = 'alice';
  const c = client(async (url,options) => {
    if (url === '/api/session') return {status:200,body:{user:{id:account},csrfToken:'renewed'}};
    calls++;
    return options.headers['X-CSRF-Token'] === 'renewed' ? {status:200,body:{revision:1}} : {status:403,body:{error:'Old CSRF'}};
  });
  await c.api.request('data',{method:'PUT',body:{},accountId:'alice'});
  assert.equal(calls,2);
  account = 'bob';
  const d = client(async url => url === '/api/session' ? {status:200,body:{user:{id:'bob'},csrfToken:'bob-token'}} : {status:403,body:{error:'Old CSRF'}});
  await assert.rejects(d.api.request('data',{method:'PUT',body:{},accountId:'alice'}),error => error.status === 401);
});
test('successful refresh clears a connection warning without requiring a data change',async () => {
  const server = service(), c = client(server.fetch), store = new c.api.AccountStore('alice');
  await store.load(); store.emit('error','Offline');
  await store.refresh(); assert.equal(store.status.kind,'saved'); store.close();
});
test('choosing remote archives pending data and preserves other tabs pending records',async () => {
  const server = service(), shared = storage(), c = client(server.fetch,shared), store = new c.api.AccountStore('alice');
  await store.load(); store.save(empty(25));
  const foreignKey = `${store.key}.pending.other-tab`;
  shared.setItem(foreignKey,JSON.stringify({revision:0,data:empty(90),dirty:true}));
  server.data = empty(50); server.revision = 1;
  const remote = await store.useRemote();
  assert.equal(remote.budgets['2026-01'],50);
  assert.equal(JSON.parse(shared.getItem(foreignKey)).data.budgets['2026-01'],90);
  assert.ok([...shared.map.keys()].some(key => key.startsWith(`${store.key}.backup.`)));
  store.close(true);
  assert.ok(shared.getItem(foreignKey));
});
