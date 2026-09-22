'use strict';

// Node 24+. Serve this process behind HTTPS in production.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const Finance = require('./finance.js');
const { createMailer } = require('./mailer.cjs');
const { createChatService } = require('./chat-service.cjs');

const derive = promisify(scrypt);
const SCRYPT = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
const COOKIE = 'finanto_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const RESET_MS = 30 * 60 * 1000;
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/auth.css', ['auth.css', 'text/css; charset=utf-8']],
  ['/finance.js', ['finance.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/api.js', ['api.js', 'text/javascript; charset=utf-8']],
  ['/tour.js', ['tour.js', 'text/javascript; charset=utf-8']],
  ['/tour.css', ['tour.css', 'text/css; charset=utf-8']],
  ['/chat.js', ['chat.js', 'text/javascript; charset=utf-8']],
  ['/chat.css', ['chat.css', 'text/css; charset=utf-8']]
]);

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function localIPv4Addresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flat().filter(entry => entry && entry.family === 'IPv4' && !entry.internal).map(entry => entry.address))];
}

function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128 || !/[\p{P}\p{S}]/u.test(password)) {
    throw new HttpError(400, 'Use de 8 a 128 caracteres e pelo menos 1 caractere especial (ex.: !, @, #).');
  }
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const [local, domain, extra] = email.split('@');
  if (email.length > 254 || !local || local.length > 64 || !domain || extra !== undefined ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
      !domain.includes('.') || domain.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new HttpError(400, 'Informe um e-mail válido.');
  }
  return email;
}

function sessionToken(req) {
  const matches = (req.headers.cookie || '').split(';').map(item => item.trim()).filter(item => item.startsWith(COOKIE + '='));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function readJSON(req, maxBytes) {
  if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    req.resume();
    throw new HttpError(415, 'Envie os dados no formato JSON.');
  }
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
    req.resume();
    throw new HttpError(415, 'A codificação do pedido não é aceita.');
  }
  if (Number(req.headers['content-length'] || 0) > maxBytes) {
    req.resume();
    throw new HttpError(413, 'O pedido excede o tamanho permitido.');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', chunk => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        chunks.length = 0;
        reject(new HttpError(413, 'O pedido excede o tamanho permitido.'));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch { reject(new HttpError(400, 'O pedido contém um JSON inválido.')); }
    });
    req.on('error', () => { if (!done) { done = true; reject(new HttpError(400, 'Não foi possível ler o pedido.')); } });
    req.on('aborted', () => { if (!done) { done = true; reject(new HttpError(400, 'O pedido foi interrompido.')); } });
  });
}

function createServer(options = {}) {
  const production = options.production === undefined ? process.env.NODE_ENV === 'production' : options.production;
  const suppliedOrigin = options.publicOrigin === undefined ? (process.env.PUBLIC_ORIGIN || '') : options.publicOrigin;
  let publicOrigin = null;
  if (suppliedOrigin) {
    const parsed = new URL(suppliedOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('PUBLIC_ORIGIN precisa ser a origem do site, por exemplo https://orcaviva.exemplo.com.');
    }
    publicOrigin = parsed.origin;
  }
  if (production && (!publicOrigin || !publicOrigin.startsWith('https://'))) {
    throw new Error('Em produção, configure PUBLIC_ORIGIN com a origem HTTPS do site.');
  }
  const secureCookie = Boolean(publicOrigin && publicOrigin.startsWith('https://'));
  const mailer = options.mailer === undefined ? createMailer() : options.mailer;
  const dbPath = options.dbPath || process.env.FINANTO_DB || path.join(__dirname, 'data', 'finanto.sqlite');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS account_data (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);
  // Additive migration: existing accounts, passwords, sessions and expenses stay intact.
  const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
  if (!columns.has('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE');
  if (!columns.has('tour_completed')) db.exec('ALTER TABLE users ADD COLUMN tour_completed INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email) WHERE email IS NOT NULL;
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id);`);
  const chat = createChatService(db);
  const statements = {
    user: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE'),
    addUser: db.prepare('INSERT INTO users (id, username, name, salt, password_hash, created_at, email) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    addEmail: db.prepare('UPDATE users SET email = ? WHERE id = ? AND email IS NULL'),
    finishTour: db.prepare('UPDATE users SET tour_completed = 1 WHERE id = ?'),
    addReset: db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    reset: db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?'),
    deleteReset: db.prepare('DELETE FROM password_resets WHERE token_hash = ?'),
    clearResets: db.prepare('DELETE FROM password_resets WHERE user_id = ?'),
    expireResets: db.prepare('DELETE FROM password_resets WHERE expires_at <= ?'),
    updatePassword: db.prepare('UPDATE users SET salt = ?, password_hash = ? WHERE id = ?'),
    clearSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    addData: db.prepare('INSERT INTO account_data (user_id, payload, revision, updated_at) VALUES (?, NULL, 0, ?)'),
    data: db.prepare('SELECT payload, revision FROM account_data WHERE user_id = ?'),
    updateData: db.prepare('UPDATE account_data SET payload = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?'),
    session: db.prepare(`SELECT sessions.csrf_token, sessions.expires_at, users.id, users.username, users.name, users.email, users.tour_completed
      FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?`),
    addSession: db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    trimSessions: db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN
      (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10)`),
    expireSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
  };
  const now = options.now || Date.now;
  const limits = { windowMs: 15 * 60 * 1000, authPerIP: 40, loginPerUsername: 10, registerPerIP: 5, recoveryPerIP: 10, recoveryPerEmail: 3, maxEntries: 5000, ...options.rateLimits };
  const attempts = new Map();
  let activeHashes = 0;
  let activeMail = 0;
  let closing = false;
  let databaseClosed = false;
  const dummySalt = randomBytes(16);
  const dummyHash = randomBytes(64);
  function maybeCloseDatabase() {
    if (closing && activeHashes === 0 && activeMail === 0 && !databaseClosed) { databaseClosed = true; db.close(); }
  }
  function cleanup() {
    const timestamp = now();
    statements.expireSessions.run(timestamp);
    statements.expireResets.run(timestamp);
    for (const [key, value] of attempts) if (value.expiresAt <= timestamp) attempts.delete(key);
  }
  cleanup();
  const cleanupTimer = setInterval(cleanup, 60 * 1000);
  cleanupTimer.unref();

  function hitLimit(key, limit, res) {
    const timestamp = now();
    let entry = attempts.get(key);
    if (!entry || entry.expiresAt <= timestamp) {
      if (attempts.size >= limits.maxEntries) {
        for (const [oldKey, value] of attempts) if (value.expiresAt <= timestamp) attempts.delete(oldKey);
      }
      if (attempts.size >= limits.maxEntries && !attempts.has(key)) {
        res.setHeader('Retry-After', '60');
        throw new HttpError(429, 'Muitas tentativas. Aguarde um minuto e tente novamente.');
      }
      entry = { count: 0, expiresAt: timestamp + limits.windowMs };
      attempts.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.expiresAt - timestamp) / 1000))));
      throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    }
  }

  function expectedOrigin(req) {
    if (publicOrigin) return publicOrigin;
    let parsed;
    try { parsed = new URL('http://' + req.headers.host); }
    catch { throw new HttpError(400, 'O endereço do servidor é inválido.'); }
    const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', os.hostname().toLowerCase(), ...localIPv4Addresses()]);
    if (!allowedHosts.has(parsed.hostname) || Number(parsed.port || 80) !== req.socket.localPort || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new HttpError(403, 'Configure PUBLIC_ORIGIN para acessar este servidor por outro endereço.');
    }
    return parsed.origin;
  }

  function verifyMutation(req, origin, session) {
    if (req.headers.origin !== origin || req.headers['x-requested-with'] !== 'finanto') {
      throw new HttpError(403, 'A origem do pedido não foi autorizada. Atualize a página.');
    }
    if (session && !safeEqual(req.headers['x-csrf-token'], session.csrf_token)) {
      throw new HttpError(403, 'A sessão de segurança mudou. Atualize a página.');
    }
  }

  function getSession(req) {
    const token = sessionToken(req);
    if (!token) return null;
    const row = statements.session.get(tokenHash(token));
    if (!row) return null;
    if (row.expires_at <= now()) { statements.deleteSession.run(tokenHash(token)); return null; }
    return row;
  }

  function requireSession(req) {
    const session = getSession(req);
    if (!session) throw new HttpError(401, 'Entre na sua conta para continuar.');
    // A different tab can change the browser cookie. Bind each data request to the
    // account the calling tab loaded, without ever trusting it as authorization.
    if (req.headers['x-finanto-account'] !== session.id) {
      throw new HttpError(401, 'A conta conectada mudou. Entre novamente para continuar.');
    }
    return session;
  }

  function setCookie(res, token, clear = false) {
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : Math.floor(SESSION_MS / 1000)}${secureCookie ? '; Secure' : ''}`);
  }

  function publicUser(row) { return { id: row.id, username: row.username, name: row.name, email: row.email || null, tourCompleted: Boolean(row.tour_completed) }; }
  function publicSession(row) { return { user: publicUser(row), csrfToken: row.csrf_token }; }

  function startSession(req, res, user) {
    const previousToken = sessionToken(req);
    if (previousToken) statements.deleteSession.run(tokenHash(previousToken));
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    statements.addSession.run(tokenHash(token), user.id, csrfToken, now(), now() + SESSION_MS);
    statements.trimSessions.run(user.id, user.id);
    setCookie(res, token);
    return { user: publicUser(user), csrfToken };
  }

  function credentials(body, registering) {
    if (typeof body.username !== 'string' || !/^[a-zA-Z0-9._-]{3,30}$/.test(body.username.trim())) {
      throw new HttpError(400, 'O usuário deve ter de 3 a 30 letras, números, pontos, traços ou sublinhados.');
    }
    if (typeof body.password !== 'string' || !body.password.length || body.password.length > 128) {
      throw new HttpError(400, 'Informe sua senha (até 128 caracteres).');
    }
    if (registering) validatePassword(body.password);
    const username = body.username.trim().toLowerCase();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (registering && (name.length < 1 || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name))) {
      throw new HttpError(400, 'Informe um nome com até 60 caracteres.');
    }
    return { username, password: body.password, name, email: registering ? normalizeEmail(body.email) : null };
  }

  async function hashPassword(password, salt, res) {
    if (activeHashes >= 2) {
      res.setHeader('Retry-After', '2');
      throw new HttpError(503, 'O servidor está ocupado. Tente novamente em alguns segundos.');
    }
    activeHashes += 1;
    try { return await derive(password, salt, 64, SCRYPT); }
    finally { activeHashes -= 1; maybeCloseDatabase(); }
  }

  function sendJSON(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  }

  async function handle(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      if (closing) throw new HttpError(503, 'O servidor está reiniciando. Tente novamente.');
      const origin = expectedOrigin(req);
      // Match the raw path before URL normalization: private files and traversal never reach disk.
      const pathname = (req.url || '').split('?')[0];
      if (pathname === '/api/session' && req.method === 'GET') {
        const session = getSession(req);
        sendJSON(res, 200, session ? publicSession(session) : { user: null });
        return;
      }
      if (pathname === '/api/forgot-password' && req.method === 'POST') {
        verifyMutation(req, origin);
        hitLimit('recovery-ip:' + req.socket.remoteAddress, limits.recoveryPerIP, res);
        const body = await readJSON(req, 16 * 1024);
        const email = normalizeEmail(body.email);
        hitLimit('recovery-email:' + tokenHash(email), limits.recoveryPerEmail, res);
        if (!mailer) throw new HttpError(503, 'O envio de e-mails ainda não foi configurado. Entre em contato com quem administra o site.');
        if (activeMail >= 20) throw new HttpError(503, 'O envio está ocupado. Tente novamente em alguns minutos.');
        // Respond before SMTP for both known and unknown addresses; never expose account existence.
        activeMail++;
        setImmediate(async () => {
          let hash;
          try {
            const user = statements.userByEmail.get(email);
            if (!user || closing) return;
            const token = randomBytes(32).toString('base64url');
            hash = tokenHash(token);
            statements.addReset.run(hash, user.id, now() + RESET_MS);
            await mailer.sendReset({ email, url: `${publicOrigin || origin}/#reset=${token}` });
          } catch {
            if (hash) statements.deleteReset.run(hash);
            console.error('Orçaviva: não foi possível enviar um e-mail de recuperação. Verifique o serviço SMTP.');
          } finally { activeMail--; maybeCloseDatabase(); }
        });
        sendJSON(res, 200, { message: 'Se existir uma conta com esse e-mail, você receberá um link válido por 30 minutos. Confira também o spam. Se não chegar, tente novamente em alguns minutos.' });
        return;
      }
      if (pathname === '/api/reset-password' && req.method === 'POST') {
        verifyMutation(req, origin);
        hitLimit('reset-ip:' + req.socket.remoteAddress, limits.authPerIP, res);
        const body = await readJSON(req, 16 * 1024);
        validatePassword(body.password);
        const invalid = () => new HttpError(400, 'Este link expirou ou já foi utilizado. Solicite um novo e-mail.');
        if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) throw invalid();
        const hash = tokenHash(body.token);
        const reset = statements.reset.get(hash, now());
        if (!reset) throw invalid();
        const salt = randomBytes(16);
        const passwordHash = await hashPassword(body.password, salt, res);
        if (closing || res.destroyed) return;
        // Recheck after asynchronous hashing: concurrent use or expiration cannot bypass single use.
        db.exec('BEGIN IMMEDIATE');
        try {
          if (!statements.reset.get(hash, now())) throw invalid();
          statements.updatePassword.run(salt.toString('hex'), passwordHash.toString('hex'), reset.user_id);
          statements.clearResets.run(reset.user_id);
          statements.clearSessions.run(reset.user_id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        sendJSON(res, 200, { message: 'Senha atualizada. Entre novamente com sua nova senha.' });
        return;
      }
      if ((pathname === '/api/register' || pathname === '/api/login') && req.method === 'POST') {
        verifyMutation(req, origin);
        const ip = req.socket.remoteAddress || 'unknown';
        hitLimit('auth-ip:' + ip, limits.authPerIP, res);
        const registering = pathname === '/api/register';
        if (registering) hitLimit('register-ip:' + ip, limits.registerPerIP, res);
        const body = await readJSON(req, 16 * 1024);
        const { username, password, name, email } = credentials(body, registering);
        hitLimit('username:' + username, limits.loginPerUsername, res);
        const existingUser = statements.user.get(username);
        const salt = registering ? randomBytes(16) : (existingUser ? Buffer.from(existingUser.salt, 'hex') : dummySalt);
        const hash = await hashPassword(password, salt, res);
        if (closing || res.destroyed) return;
        if (registering) {
          if (existingUser || statements.user.get(username)) throw new HttpError(409, 'Este nome de usuário já está em uso.');
          if (statements.userByEmail.get(email)) throw new HttpError(409, 'Este e-mail já está em uso. Entre na sua conta ou recupere a senha.');
          const user = { id: randomUUID(), username, name, email, tour_completed: 0 };
          db.exec('BEGIN IMMEDIATE');
          try {
            statements.addUser.run(user.id, username, name, salt.toString('hex'), hash.toString('hex'), now(), email);
            statements.addData.run(user.id, now());
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          sendJSON(res, 201, startSession(req, res, user));
        } else {
          const expectedHash = existingUser ? Buffer.from(existingUser.password_hash, 'hex') : dummyHash;
          if (!timingSafeEqual(hash, expectedHash) || !existingUser) throw new HttpError(401, 'Usuário ou senha incorretos.');
          const latestUser = statements.userById.get(existingUser.id);
          if (latestUser.password_hash !== existingUser.password_hash) throw new HttpError(401, 'A senha foi alterada. Entre com sua nova senha.');
          sendJSON(res, 200, startSession(req, res, latestUser));
        }
        return;
      }
      if (pathname === '/api/account/email' && req.method === 'POST') {
        const session = requireSession(req);
        verifyMutation(req, origin, session);
        hitLimit('email-account:' + session.id, limits.loginPerUsername, res);
        const body = await readJSON(req, 16 * 1024);
        const email = normalizeEmail(body.email);
        const user = statements.userById.get(session.id);
        if (user.email) throw new HttpError(409, 'Esta conta já tem um e-mail cadastrado.');
        if (typeof body.password !== 'string' || !body.password.length || body.password.length > 128) throw new HttpError(400, 'Informe sua senha atual.');
        const hash = await hashPassword(body.password, Buffer.from(user.salt, 'hex'), res);
        if (closing || res.destroyed) return;
        if (!timingSafeEqual(hash, Buffer.from(user.password_hash, 'hex'))) throw new HttpError(401, 'A senha atual está incorreta.');
        requireSession(req);
        if (statements.userByEmail.get(email)) throw new HttpError(409, 'Este e-mail já está em uso.');
        if (!statements.addEmail.run(email, user.id).changes) throw new HttpError(409, 'Esta conta já tem um e-mail cadastrado.');
        sendJSON(res, 200, { user: publicUser(statements.userById.get(user.id)) });
        return;
      }
      if (pathname === '/api/account/tour' && req.method === 'POST') {
        const session = requireSession(req);
        verifyMutation(req, origin, session);
        await readJSON(req, 16 * 1024);
        statements.finishTour.run(session.id);
        sendJSON(res, 200, { completed: true });
        return;
      }
      if (pathname === '/api/logout' && req.method === 'POST') {
        const session = requireSession(req);
        verifyMutation(req, origin, session);
        await readJSON(req, 16 * 1024);
        statements.deleteSession.run(tokenHash(sessionToken(req)));
        setCookie(res, '', true);
        res.writeHead(204);
        res.end();
        return;
      }
      if (pathname === '/api/chat' && (req.method === 'GET' || req.method === 'POST')) {
        const session = requireSession(req);
        if (req.method === 'GET') { sendJSON(res,200,chat.get(session.id)); return; }
        verifyMutation(req,origin,session);
        hitLimit('chat:' + session.id,120,res);
        const body = await readJSON(req,16 * 1024);
        requireSession(req);
        try { sendJSON(res,200,chat.send(session.id,body,now())); }
        catch (error) { if (error.status) throw new HttpError(error.status,error.message); throw error; }
        return;
      }
      if (pathname === '/api/data' && (req.method === 'GET' || req.method === 'PUT')) {
        const session = requireSession(req);
        if (req.method === 'GET') {
          const row = statements.data.get(session.id);
          sendJSON(res, 200, { data: row.payload === null ? null : JSON.parse(row.payload), revision: row.revision });
          return;
        }
        verifyMutation(req, origin, session);
        const body = await readJSON(req, 8 * 1024 * 1024);
        if (!Number.isSafeInteger(body.revision) || body.revision < 0 || body.revision >= Number.MAX_SAFE_INTEGER) {
          throw new HttpError(400, 'A revisão dos dados é inválida. Atualize a página.');
        }
        let validated;
        try { validated = Finance.validateBackup(body.data); }
        catch (error) { throw new HttpError(400, error.message); }
        const updated = statements.updateData.run(JSON.stringify(validated), now(), session.id, body.revision);
        if (updated.changes === 0) {
          const latest = statements.data.get(session.id);
          throw new HttpError(409, 'Os dados foram alterados em outro dispositivo. Carregue a versão mais recente antes de salvar.', {
            data: latest.payload === null ? null : JSON.parse(latest.payload), revision: latest.revision
          });
        }
        sendJSON(res, 200, { revision: body.revision + 1 });
        return;
      }
      const file = STATIC_FILES.get(pathname);
      if (file && (req.method === 'GET' || req.method === 'HEAD')) {
        const fullPath = path.join(__dirname, file[0]);
        let content;
        try { content = await fs.promises.readFile(fullPath); }
        catch (error) { if (error.code === 'ENOENT') throw new HttpError(404, 'Arquivo não encontrado.'); throw error; }
        res.writeHead(200, { 'Content-Type': file[1], 'Content-Length': content.length });
        res.end(req.method === 'HEAD' ? undefined : content);
        return;
      }
      throw new HttpError(404, 'Endereço não encontrado.');
    } catch (error) {
      req.resume();
      if (res.destroyed || res.headersSent) return;
      if (error instanceof HttpError) sendJSON(res, error.status, { error: error.message, ...error.extra });
      else {
        // Do not include credentials, requests, SQL, or database paths in responses/logs.
        console.error('Orçaviva: erro interno ao processar um pedido.');
        sendJSON(res, 500, { error: 'Não foi possível concluir o pedido. Tente novamente.' });
      }
    }
  }

  const server = http.createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 30_000, headersTimeout: 15_000, keepAliveTimeout: 5_000 }, handle);
  server.on('close', () => { closing = true; clearInterval(cleanupTimer); maybeCloseDatabase(); });
  return server;
}

if (require.main === module) {
  try {
    const envFile = path.join(__dirname, '.env');
    if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser um número entre 1 e 65535.');
    const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');
    const server = createServer();
    server.listen(port, host, () => {
      if (process.env.PUBLIC_ORIGIN) console.log(`Orçaviva disponível em ${process.env.PUBLIC_ORIGIN}`);
      else {
        console.log(`Orçaviva neste computador: http://localhost:${port}`);
        if (host === '0.0.0.0' || host === '::') {
          for (const address of localIPv4Addresses()) console.log(`Orçaviva na rede local: http://${address}:${port}`);
        } else if (host !== '127.0.0.1' && host !== 'localhost') console.log(`Orçaviva: http://${host}:${port}`);
      }
    });
    server.on('error', error => { console.error('Não foi possível iniciar o Orçaviva:', error.message); process.exitCode = 1; server.close(); });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { createServer };
