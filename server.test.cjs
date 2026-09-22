'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { createHash, scryptSync, randomBytes } = require('node:crypto');
const Finance = require('./finance.js');
const { createServer } = require('./server.cjs');

const password = 'minha senha forte 2026!';

async function running(options = {}) {
  const server = createServer({ dbPath: ':memory:', production: false, publicOrigin: '', mailer: null, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  return {
    server, origin,
    async close() {
      if (!server.listening) return;
      const closed = once(server, 'close');
      server.close();
      server.closeIdleConnections();
      await closed;
    },
    async request(route, { method = 'GET', body, headers = {}, account, rawBody } = {}) {
      const outgoing = { Origin: options.publicOrigin || origin, 'X-Requested-With': 'finanto', ...headers };
      if (account) {
        outgoing.Cookie = account.cookie;
        outgoing['X-CSRF-Token'] = account.csrfToken;
        outgoing['X-Finanto-Account'] = account.user.id;
      }
      // Explicit headers can intentionally override otherwise valid auth headers.
      Object.assign(outgoing, headers);
      for (const key of Object.keys(outgoing)) if (outgoing[key] === null) delete outgoing[key];
      if (body !== undefined || rawBody !== undefined) outgoing['Content-Type'] ||= 'application/json';
      const response = await fetch(origin + route, {
        method, headers: outgoing, body: rawBody === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : rawBody
      });
      const responseBody = await response.text();
      let json;
      try { json = JSON.parse(responseBody); } catch { json = null; }
      return { status: response.status, headers: response.headers, text: responseBody, json };
    },
    async register(username, overrides = {}) {
      const response = await this.request('/api/register', { method: 'POST', body: { name: 'Pessoa de teste', username, email: `${username}@example.com`, password, ...overrides } });
      assert.equal(response.status, 201, response.text);
      return { ...response.json, cookie: response.headers.get('set-cookie').split(';')[0], response };
    }
  };
}

function backup(overrides = {}) {
  return { version: 1, expenses: [], budgets: { '2026-09': 150000 }, preferences: { selectedMonth: '2026-09' }, customCategories: [], ...overrides };
}

test('HTTP accounts, persistence, sessions and account-isolated revision updates', async t => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempRoot, 'finanto-server-'));
  const dbPath = path.join(directory, 'test.sqlite');
  let app = await running({ dbPath });
  t.after(async () => {
    await app.close();
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith('finanto-server-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  let result = await app.request('/api/session');
  assert.equal(result.status, 200);
  assert.deepEqual(result.json, { user: null });
  assert.equal((await app.request('/api/data')).status, 401);
  const alice = await app.register('Alice.Test');
  assert.equal(alice.user.username, 'alice.test');
  assert.match(alice.response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=43200/);
  assert.ok(!alice.response.headers.get('set-cookie').includes('Secure'));
  result = await app.request('/api/session', { account: alice });
  assert.deepEqual(result.json, { user: alice.user, csrfToken: alice.csrfToken });
  result = await app.request('/api/data', { account: alice });
  assert.deepEqual(result.json, { data: null, revision: 0 });

  const bob = await app.register('bob.test');
  const category = Finance.createCategory('Educação', []);
  const expense = Finance.createExpense({ name: 'Curso', category: category.id, totalCents: 10000, installments: 3, date: '2026-09-10' }, 'expense-test', [category]);
  const data = backup({ customCategories: [category], expenses: [expense] });
  result = await app.request('/api/data', { method: 'PUT', account: alice, body: { data, revision: 0, userId: bob.user.id } });
  assert.deepEqual(result.json, { revision: 1 });
  assert.equal(result.status, 200);
  result = await app.request('/api/data', { account: alice });
  assert.deepEqual(result.json, { data: Finance.validateBackup(data), revision: 1 });
  result = await app.request('/api/data', { account: bob });
  assert.deepEqual(result.json, { data: null, revision: 0 });
  result = await app.request('/api/data', { method: 'PUT', account: alice, body: { data: backup(), revision: 0 } });
  assert.equal(result.status, 409);
  assert.equal(result.json.revision, 1);
  assert.deepEqual(result.json.data, Finance.validateBackup(data));

  result = await app.request('/api/data', { method: 'PUT', account: bob, headers: { 'X-Finanto-Account': alice.user.id }, body: { data, revision: 0 } });
  assert.equal(result.status, 401, 'stale tab must not overwrite a new account');
  assert.equal((await app.request('/api/data', { account: alice, headers: { 'X-Finanto-Account': null } })).status, 401);
  assert.equal((await app.request('/api/logout', { method: 'POST', account: bob, headers: { 'X-Finanto-Account': alice.user.id }, body: {} })).status, 401);

  const before = new DatabaseSync(dbPath);
  const storedUser = before.prepare('SELECT * FROM users WHERE id = ?').get(alice.user.id);
  assert.notEqual(storedUser.password_hash, password);
  assert.equal(storedUser.salt.length, 32);
  assert.equal(storedUser.password_hash.length, 128);
  const plainToken = alice.cookie.split('=')[1];
  const hashedToken = createHash('sha256').update(plainToken).digest('hex');
  assert.ok(before.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashedToken));
  assert.equal(before.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(plainToken), undefined);
  before.close();

  await app.close();
  app = await running({ dbPath });
  result = await app.request('/api/data', { account: alice });
  assert.deepEqual(result.json, { data: Finance.validateBackup(data), revision: 1 }, 'data and session survive restart');
  result = await app.request('/api/login', { method: 'POST', body: { username: 'ALICE.TEST', password: 'senha incorreta 123' } });
  assert.equal(result.status, 401);
  const missing = await app.request('/api/login', { method: 'POST', body: { username: 'missing-user', password: 'senha incorreta 123' } });
  assert.equal(missing.status, 401);
  assert.deepEqual(missing.json, result.json);
  result = await app.request('/api/login', { method: 'POST', account: alice, body: { username: 'ALICE.TEST', password } });
  assert.equal(result.status, 200);
  const relogged = { ...result.json, cookie: result.headers.get('set-cookie').split(';')[0] };
  assert.notEqual(relogged.cookie, alice.cookie);
  assert.deepEqual((await app.request('/api/session', { account: alice })).json, { user: null });
  assert.equal((await app.request('/api/data', { account: relogged })).status, 200);
  result = await app.request('/api/logout', { method: 'POST', account: relogged, body: {} });
  assert.equal(result.status, 204);
  assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await app.request('/api/data', { account: relogged })).status, 401);
  assert.equal((await app.request('/api/data', { account: bob })).status, 200);
});

test('origin, CSRF, bodies, private paths and headers are enforced', async t => {
  const app = await running({ rateLimits: { authPerIP: 100, registerPerIP: 100, loginPerUsername: 100 } });
  t.after(() => app.close());
  const account = await app.register('security-test');
  for (const headers of [{ Origin: 'https://attacker.example' }, { Origin: null }, { 'X-Requested-With': null }]) {
    const result = await app.request('/api/login', { method: 'POST', headers, body: { username: 'security-test', password } });
    assert.equal(result.status, 403);
  }
  for (const headers of [{ 'X-CSRF-Token': 'invalid' }, { 'X-CSRF-Token': null }, { Origin: 'https://attacker.example' }]) {
    assert.equal((await app.request('/api/data', { method: 'PUT', account, headers, body: { data: backup(), revision: 0 } })).status, 403);
    assert.equal((await app.request('/api/logout', { method: 'POST', account, headers, body: {} })).status, 403);
  }
  assert.equal((await app.request('/api/data', { method: 'PUT', account, headers: { 'Content-Type': 'text/plain' }, body: {} })).status, 415);
  assert.equal((await app.request('/api/data', { method: 'PUT', account, rawBody: '{broken' })).status, 400);
  assert.equal((await app.request('/api/data', { method: 'PUT', account, body: [] })).status, 400);
  assert.equal((await app.request('/api/data', { method: 'PUT', account, body: { data: backup(), revision: -1 } })).status, 400);
  assert.equal((await app.request('/api/data', { method: 'PUT', account, body: { data: backup({ expenses: [{}] }), revision: 0 } })).status, 400);
  assert.equal((await app.request('/api/register', { method: 'POST', rawBody: JSON.stringify({ padding: 'x'.repeat(16384) }) })).status, 413);
  assert.equal((await app.request('/api/register', { method: 'POST', body: { name: 'Teste', username: 'short', password: 'curta' } })).status, 400);
  assert.equal((await app.request('/api/register', { method: 'POST', body: { name: 'Teste', username: 'invalid@user', password } })).status, 400);
  assert.equal((await app.request('/api/register', { method: 'POST', body: { name: 'Teste', username: 'SECURITY-TEST', email: 'duplicate@example.com', password } })).status, 409);
  const spacedPassword = '  senha com espaços!  ';
  const spaced = await app.register('spaces-test', { password: spacedPassword });
  assert.equal((await app.request('/api/login', { method: 'POST', body: { username: spaced.user.username, password: spacedPassword.trim() } })).status, 401);
  assert.equal((await app.request('/api/login', { method: 'POST', body: { username: spaced.user.username, password: spacedPassword } })).status, 200);
  for (const route of ['/server.cjs', '/server.test.cjs', '/package.json', '/.gitignore', '/data/finanto.sqlite', '/data/finanto.sqlite-wal', '/README.md', '/%2e%2e%2fserver.cjs', '/.git/config', '/.env', '/.env.example', '/mailer.cjs', '/node_modules/nodemailer/package.json']) {
    const result = await app.request(route);
    assert.equal(result.status, 404, route);
    assert.match(result.headers.get('content-type'), /application\/json/);
  }
  const page = await app.request('/');
  assert.equal(page.status, 200);
  assert.match(page.text, /<!DOCTYPE html>/i);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('access-control-allow-origin'), null);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(app.origin + '/', { headers: { Host: 'attacker.example' } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  const head = await app.request('/finance.js', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
});

test('rate limits expire and secure sessions expire after twelve hours', async t => {
  let timestamp = Date.now();
  const app = await running({ publicOrigin: 'https://finance.example', now: () => timestamp, rateLimits: { loginPerUsername: 2, authPerIP: 20, registerPerIP: 2, windowMs: 1000 } });
  t.after(() => app.close());
  const account = await app.register('expiring-test');
  assert.match(account.response.headers.get('set-cookie'), /; Secure/);
  assert.equal(account.response.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal((await app.request('/api/login', { method: 'POST', body: { username: account.user.username, password: 'wrong password 2026' } })).status, 401);
  const limited = await app.request('/api/login', { method: 'POST', body: { username: account.user.username, password } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '1');
  timestamp += 1001;
  assert.equal((await app.request('/api/login', { method: 'POST', body: { username: account.user.username, password } })).status, 200);
  timestamp += 12 * 60 * 60 * 1000;
  assert.deepEqual((await app.request('/api/session', { account })).json, { user: null });
  assert.equal((await app.request('/api/data', { account })).status, 401);
});

test('LAN addresses accept login while foreign hosts, ports and origins remain blocked', async t => {
  const app = await running();
  t.after(() => app.close());
  const address = Object.values(os.networkInterfaces()).flat().find(entry => entry?.family === 'IPv4' && !entry.internal)?.address || 'localhost';
  const lanHost = `${address}:${app.server.address().port}`;
  const lanOrigin = `http://${lanHost}`;
  async function requestWithHost(route, host, origin, body) {
    return new Promise((resolve,reject) => {
      const req = http.request(app.origin+route,{method:body ? 'POST' : 'GET',headers:{Host:host,Origin:origin,'X-Requested-With':'finanto','Content-Type':'application/json'}},res => {
        let text = ''; res.setEncoding('utf8'); res.on('data',chunk => text += chunk);
        res.on('end',() => resolve({status:res.statusCode,text}));
      });
      req.on('error',reject); req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  assert.equal((await requestWithHost('/',lanHost,lanOrigin)).status,200);
  const credentials = {name:'Teste LAN',username:'lan-user',email:'lan@example.com',password};
  assert.equal((await requestWithHost('/api/register',lanHost,lanOrigin,credentials)).status,201);
  assert.equal((await requestWithHost('/api/login',lanHost,lanOrigin,credentials)).status,200);
  assert.equal((await requestWithHost('/api/login',lanHost,'http://untrusted.example',credentials)).status,403);
  assert.equal((await requestWithHost('/','untrusted.example:'+app.server.address().port,'http://untrusted.example')).status,403);
  assert.equal((await requestWithHost('/',address+':1','http://'+address+':1')).status,403);
});

test('production refuses missing or insecure public origin', () => {
  assert.throws(() => createServer({ production: true, publicOrigin: '', dbPath: ':memory:' }), /HTTPS/);
  assert.throws(() => createServer({ production: true, publicOrigin: 'http://finance.example', dbPath: ':memory:' }), /HTTPS/);
  for (const publicOrigin of ['https://finance.example/path', 'https://user:password@finance.example', 'file:///tmp']) {
    assert.throws(() => createServer({ production: false, publicOrigin, dbPath: ':memory:' }), /PUBLIC_ORIGIN/);
  }
});

test('concurrent password hashing is bounded and registration rate limits apply', async t => {
  const app = await running({ rateLimits: { registerPerIP: 3 } });
  t.after(() => app.close());
  const results = await Promise.all(['concurrent-one', 'concurrent-two', 'concurrent-three'].map(username => app.request('/api/register', {
    method: 'POST', body: { name: 'Teste', username, email: `${username}@example.com`, password }
  })));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 201, 503]);
  assert.equal(results.find(result => result.status === 503).headers.get('retry-after'), '2');
  assert.equal((await app.request('/api/register', { method: 'POST', body: { name: 'Teste', username: 'concurrent-four', password } })).status, 429);
});

test('registration enforces email and eight characters plus a special character, preserving login rules', async t => {
  const app = await running({ rateLimits: { registerPerIP: 100, authPerIP: 100, loginPerUsername: 100 } });
  t.after(() => app.close());
  const base = { name: 'Teste', username: 'new-account', email: 'person@example.com', password: 'Abcdef1!' };
  for (const password of ['123456!', 'abcdefgh', 'abcdefg ', 'áéíóúãõç', 'a'.repeat(128) + '!']) {
    assert.equal((await app.request('/api/register', { method: 'POST', body: { ...base, password } })).status, 400, password.length);
  }
  for (const email of [undefined, '', 'invalid', 'a@b', 'a..b@example.com', 'a@-example.com', 'x\r\nBcc:y@example.com', 'a@b@example.com']) {
    assert.equal((await app.request('/api/register', { method: 'POST', body: { ...base, email } })).status, 400);
  }
  const user = await app.register('eight-chars', { password: base.password, email: ' Person@Example.COM ' });
  assert.equal(user.user.email, 'person@example.com');
  assert.equal(user.user.tourCompleted, false);
  assert.equal((await app.request('/api/register', { method: 'POST', body: { ...base, username: 'other-user', email: 'PERSON@example.com' } })).status, 409);
  assert.equal((await app.request('/api/login', { method: 'POST', body: { username: 'eight-chars', password: base.password } })).status, 200);
});

async function waitUntil(fn) {
  for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Timed out waiting for the isolated mail transport');
}

test('password reset is private, hashed, expiring, single use and invalidates all old sessions without changing expenses', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orcaviva-reset-'));
  const dbPath = path.join(directory, 'test.sqlite');
  const messages = [];
  let timestamp = Date.now();
  const app = await running({ dbPath, now: () => timestamp, publicOrigin: 'https://orcaviva.example', mailer: { sendReset: async message => { messages.push(message); } }, rateLimits: { recoveryPerEmail: 20, recoveryPerIP: 30, authPerIP: 100, loginPerUsername: 100 } });
  t.after(async () => { await app.close(); });
  const account = await app.register('reset-user');
  const other = await app.register('unaffected-user');
  await app.request('/api/data', { method: 'PUT', account, body: { data: backup(), revision: 0 } });
  const secondLogin = await app.request('/api/login', { method: 'POST', body: { username: account.user.username, password } });
  const second = { ...secondLogin.json, cookie: secondLogin.headers.get('set-cookie').split(';')[0] };
  const forgotten = email => app.request('/api/forgot-password', { method: 'POST', body: { email } });
  const known = await forgotten(account.user.email);
  const unknown = await forgotten('missing@example.com');
  assert.equal(known.status, 200);
  assert.deepEqual(known.json, unknown.json);
  await waitUntil(() => messages.length === 1);
  assert.equal(messages[0].email, account.user.email);
  const link = new URL(messages[0].url);
  assert.equal(link.origin, 'https://orcaviva.example');
  const token = link.hash.slice(7);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!known.text.includes(token));
  const inspect = new DatabaseSync(dbPath);
  const row = inspect.prepare('SELECT * FROM password_resets').get();
  assert.equal(row.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.equal(row.expires_at, timestamp + 30 * 60 * 1000);
  inspect.close();
  const reset = (token, password = 'Nova123!') => app.request('/api/reset-password', { method: 'POST', body: { token, password } });
  assert.equal((await reset(token, 'abcdefgh')).status, 400);
  assert.equal((await reset('invalid')).status, 400);
  assert.equal((await app.request('/api/reset-password', { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: { token, password: 'Nova123!' } })).status, 403);
  timestamp += 30 * 60 * 1000;
  assert.equal((await reset(token)).status, 400);
  await forgotten(account.user.email); await waitUntil(() => messages.length === 2);
  const fresh = new URL(messages[1].url).hash.slice(7);
  const results = await Promise.all([reset(fresh), reset(fresh)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
  assert.equal((await reset(fresh)).status, 400);
  assert.equal((await app.request('/api/data', { account })).status, 401);
  assert.equal((await app.request('/api/data', { account: second })).status, 401);
  assert.equal((await app.request('/api/data', { account: other })).status, 200);
  assert.equal((await app.request('/api/login', { method: 'POST', body: { username: account.user.username, password } })).status, 401);
  const loggedIn = await app.request('/api/login', { method: 'POST', body: { username: account.user.username, password: 'Nova123!' } });
  assert.equal(loggedIn.status, 200);
  const restored = { ...loggedIn.json, cookie: loggedIn.headers.get('set-cookie').split(';')[0] };
  assert.deepEqual((await app.request('/api/data', { account: restored })).json.data, Finance.validateBackup(backup()));
});

test('recovery limits apply to all addresses and unavailable SMTP never pretends to send', async t => {
  const app = await running({ mailer: null, rateLimits: { recoveryPerIP: 2, recoveryPerEmail: 1 } });
  t.after(() => app.close());
  const request = (email, headers) => app.request('/api/forgot-password', { method: 'POST', headers, body: { email } });
  assert.equal((await request('a@example.com', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await request('a@example.com')).status, 503);
  assert.equal((await request('a@example.com')).status, 429);
  assert.equal((await request('b@example.com')).status, 429);
});

test('SMTP failures remove their reset token without leaking details to the requester', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orcaviva-mail-failure-'));
  const dbPath = path.join(directory, 'test.sqlite');
  let failed = false;
  const logs = [];
  t.mock.method(console, 'error', text => logs.push(text));
  const app = await running({ dbPath, mailer: { sendReset: async () => { failed = true; throw new Error('secret SMTP password'); } } });
  t.after(() => app.close());
  const account = await app.register('mail-failure');
  const response = await app.request('/api/forgot-password', { method: 'POST', body: { email: account.user.email } });
  assert.equal(response.status, 200);
  await waitUntil(() => failed && logs.length > 0);
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare('SELECT count(*) AS count FROM password_resets').get().count, 0);
  db.close();
  assert.ok(!logs.join('').includes('secret SMTP password'));
});

test('old database migration preserves passwords and expenses; email attachment and tour are account-bound and persistent', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orcaviva-migration-'));
  const dbPath = path.join(directory, 'test.sqlite');
  const oldPassword = 'senha antiga sem simbolo';
  const salt = randomBytes(16);
  const hash = scryptSync(oldPassword, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
  const old = new DatabaseSync(dbPath);
  old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE account_data (user_id TEXT PRIMARY KEY REFERENCES users(id), payload TEXT, revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);`);
  old.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('legacy-id', 'legacy-user', 'Conta antiga', salt.toString('hex'), hash.toString('hex'), Date.now());
  old.prepare('INSERT INTO account_data VALUES (?,?,?,?)').run('legacy-id', JSON.stringify(Finance.validateBackup(backup())), 7, Date.now());
  old.close();
  let app = await running({ dbPath });
  t.after(() => app.close());
  const login = await app.request('/api/login', { method: 'POST', body: { username: 'legacy-user', password: oldPassword } });
  assert.equal(login.status, 200);
  const account = { ...login.json, cookie: login.headers.get('set-cookie').split(';')[0] };
  assert.equal(account.user.email, null);
  assert.equal(account.user.tourCompleted, false);
  assert.equal((await app.request('/api/data', { account })).json.revision, 7);
  const addEmail = (body, headers) => app.request('/api/account/email', { method: 'POST', account, body, headers });
  assert.equal((await addEmail({ email: 'legacy@example.com', password: 'wrong' })).status, 401);
  assert.equal((await addEmail({ email: 'legacy@example.com', password: oldPassword }, { 'X-CSRF-Token': null })).status, 403);
  assert.equal((await addEmail({ email: 'legacy@example.com', password: oldPassword }, { 'X-Finanto-Account': 'another-id' })).status, 401);
  const updated = await addEmail({ email: 'LEGACY@example.com', password: oldPassword });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.user.email, 'legacy@example.com');
  assert.equal((await addEmail({ email: 'changed@example.com', password: oldPassword })).status, 409);
  assert.equal((await app.request('/api/account/tour', { method: 'POST', account, headers: { 'X-CSRF-Token': null }, body: {} })).status, 403);
  assert.equal((await app.request('/api/account/tour', { method: 'POST', account, body: {} })).status, 200);
  await app.close(); app = await running({ dbPath });
  const session = (await app.request('/api/session', { account })).json;
  assert.equal(session.user.tourCompleted, true);
  assert.equal(session.user.email, 'legacy@example.com');
  assert.deepEqual((await app.request('/api/data', { account })).json, { data: Finance.validateBackup(backup()), revision: 7 });
});

test('chat HTTP authentication, CSRF, retries and account data revisions stay isolated', async t => {
  const app = await running(); t.after(() => app.close());
  assert.equal((await app.request('/api/chat')).status,401);
  const alice = await app.register('chat-alice');
  const bob = await app.register('chat-bob');
  const body = {text:'Gastei 85,90 no mercado via Pix',messageId:'chat-message-12345',revision:0,chatRevision:0};
  const post = (extra = {}) => app.request('/api/chat',{method:'POST',account:alice,body,...extra});
  assert.equal((await post({headers:{'X-CSRF-Token':null}})).status,403);
  assert.equal((await post({headers:{Origin:'https://attacker.example'}})).status,403);
  assert.equal((await post({headers:{'X-Finanto-Account':bob.user.id}})).status,401);
  const result = await post(); assert.equal(result.status,200); assert.equal(result.json.changed,true);
  assert.deepEqual((await post()).json,result.json);
  const data = (await app.request('/api/data',{account:alice})).json;
  assert.equal(data.revision,1); assert.equal(data.data.expenses.length,1);
  assert.equal(data.data.expenses[0].paymentMethod,'pix');
  assert.equal((await app.request('/api/data',{account:bob})).json.data,null);
  assert.equal((await app.request('/api/chat',{account:bob})).json.history.length,0);
  assert.equal((await post({body:{...body,text:'Gastei 100 no mercado'}})).status,409);
  assert.equal((await post({body:{...body,messageId:'different-message'}})).status,409);
  assert.equal((await post({body:{...body,text:'a'.repeat(1001)}})).status,400);
  for (const route of ['/chat-engine.cjs','/chat-service.cjs']) assert.equal((await app.request(route)).status,404);
});
