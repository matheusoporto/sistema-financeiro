/* Browser smoke tests: node sistema-financeiro/browser.test.cjs
 * Uses an isolated Microsoft Edge profile and Node's built-in CDP WebSocket.
 * Screenshots and downloads stay in the temporary directory printed at the end.
 * Starts an isolated HTTP server and SQLite database; never uses personal accounts.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./server.cjs');
const { spawn } = require('node:child_process');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'finanto-smoke-'));
const edgePath = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let appURL;
let server;
const failures = [];
let edge;
let socket;
let requests = new Map();
let sequence = 0;
let debugPort;
const pageErrors = [];
const recoveryMessages = [];

async function waitFor(fn, label, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}
function cdp(method, params = {}) {
  if (process.env.CDP_DEBUG) console.log('SEND', method);
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    requests.set(id, { resolve: (data) => { clearTimeout(timer); resolve(data); }, reject: (err) => { clearTimeout(timer); reject(err); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function click(selector) {
  await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('Missing selector: ' + ${JSON.stringify(selector)}); node.click(); })()`);
  await sleep(80);
}
async function field(selector, value) {
  await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node[${typeof value === 'boolean' ? "'checked'" : "'value'"}] = ${JSON.stringify(value)}; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}
async function read(selector) { return evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim().replace(/\\s+/g,' ')`); }
async function synced() { await waitFor(() => evaluate(`document.querySelector('#save-status').textContent.includes('Salvo na sua conta')`), 'server save'); }
async function state() { await synced(); return evaluate(`(async () => { const session = await FinantoAPI.request('session'); return (await FinantoAPI.request('data',{accountId:session.user.id})).data; })()`); }
async function reload() {
  await cdp('Page.reload', { ignoreCache: true });
  await sleep(250);
  await waitFor(() => evaluate(`document.readyState === 'complete' && !document.querySelector('#login-submit').disabled`), 'app ready');
}
async function test(name, callback) {
  try { await callback(); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function screenshot(name, resetScroll = true) {
  await evaluate(`document.querySelector('.toast-close')?.click(); document.activeElement?.blur(); ${resetScroll ? 'window.scrollTo(0,0)' : ''}`);
  await sleep(400);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const filename = path.join(output, name);
  fs.writeFileSync(filename, Buffer.from(data, 'base64'));
  console.log(`SCREENSHOT ${filename}`);
}
async function inAnotherTab(expression) {
  const { targetId } = await cdp('Target.createTarget', { url: appURL });
  await sleep(300);
  const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
  const other = new WebSocket(targets.find((target) => target.id === targetId).webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => { other.onopen = resolve; other.onerror = reject; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Second tab evaluation timed out')), 10000);
      other.onmessage = ({ data }) => {
        const result = JSON.parse(data);
        if (result.id !== 1) return;
        clearTimeout(timer);
        if (result.error || result.result?.exceptionDetails) reject(new Error(JSON.stringify(result)));
        else resolve(result.result.result.value);
      };
      other.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    await sleep(200);
  } finally {
    other.close();
    await cdp('Target.closeTarget', { targetId });
  }
}
async function addExpense({ name, amount, category, date, installments = 1, notes = '' }) {
  await click('#add-expense');
  await field('#expense-name', name);
  await field('#expense-amount', amount);
  await field('#expense-category', category);
  await field('#expense-date', date);
  await field('#expense-is-installment', installments > 1);
  if (installments > 1) await field('#expense-installments', String(installments));
  await field('#expense-notes', notes);
  await click('#save-expense');
}

(async () => {
  server = createServer({dbPath:path.join(output,'test.sqlite'),production:false,publicOrigin:'',mailer:{sendReset:async message => recoveryMessages.push(message)}});
  await new Promise(resolve => server.listen(0,process.env.BROWSER_HOST ? '0.0.0.0' : '127.0.0.1',resolve));
  appURL = `http://${process.env.BROWSER_HOST || '127.0.0.1'}:${server.address().port}`;
  edge = spawn(edgePath, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${path.join(output, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  let browserURL;
  edge.stderr.on('data', (chunk) => { stderr += chunk; if (process.env.CDP_DEBUG) console.log('EDGE', String(chunk)); browserURL = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1]; });
  edge.on('error', (error) => { stderr += error.message; });
  await waitFor(() => browserURL, `Edge launch (${edgePath})`, 20000);
  const port = new URL(browserURL).port;
  debugPort = port;
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  if (process.env.CDP_DEBUG) console.log('TARGETS', targets);
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onclose = () => {
    for (const request of requests.values()) request.reject(new Error('Edge debugging connection closed'));
    requests.clear();
  };
  socket.onmessage = ({ data }) => {
    if (process.env.CDP_DEBUG) console.log('RECV', String(data).slice(0,1000));
    const message = JSON.parse(data);
    if (message.id && requests.has(message.id)) {
      const request = requests.get(message.id); requests.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails);
    else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') pageErrors.push(message.params.entry);
  };
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: appURL });
  await waitFor(() => evaluate(`document.readyState === 'complete' && !document.querySelector('#login-submit').disabled`), 'initial app ready');


  const password = 'Uma senha de teste 2026!';
  async function loggedIn() { await waitFor(() => evaluate("!document.querySelector('#app-shell').hidden"), 'login complete'); await synced(); }
  async function loggedOut() { await waitFor(() => evaluate("!document.querySelector('#auth-screen').hidden && !document.querySelector('#login-submit').disabled"), 'logout complete'); }
  async function register(username,name) {
    await click('#show-register'); await field('#register-name',name); await field('#register-username',username);
    await field('#register-email',username+'@example.com');
    await field('#register-password',password); await field('#register-confirm',password);
    await click('#register-submit'); await loggedIn();
    await waitFor(() => evaluate("document.querySelector('#tour-dialog').open"),'new account tour');
    await click('#tour-skip'); await waitFor(() => evaluate("!document.querySelector('#tour-dialog').open"),'skip tour');
  }
  async function login(username) {
    await click('#show-login'); await field('#login-username',username); await field('#login-password',password);
    await click('#login-submit'); await loggedIn();
  }
  await test('login gate and desktop access screen',async () => {
    if (process.env.BROWSER_HOST) {
      assert.equal(await evaluate('window.isSecureContext'),false,'LAN test must exercise a regular HTTP origin');
      assert.equal(await evaluate('typeof crypto.randomUUID'),'undefined');
    }
    assert.equal(await evaluate("document.querySelector('#app-shell').hidden"),true);
    assert.equal(await evaluate("document.querySelector('#app-shell').inert"),true);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"),true);
    await screenshot('login-desktop.png');
  });
  await test('registration validates confirmation and opens an empty personal account',async () => {
    await click('#show-register'); await field('#register-name','Matheus QA'); await field('#register-username','matheus.qa');
    await field('#register-email','matheus.qa@example.com');
    await field('#register-password','abcdefgh'); await field('#register-confirm','abcdefgh');
    assert.equal(await evaluate("document.querySelector('#register-password').checkValidity()"),false);
    await field('#register-password','Teste12!');
    assert.equal(await evaluate("document.querySelector('#register-password').checkValidity()"),true);
    await field('#register-password',password); await field('#register-confirm','Senha diferente 123');
    await click('#register-submit');
    assert.ok((await read('#auth-message')).includes('não coincidem'));
    await field('#register-confirm',password); await click('#register-submit'); await loggedIn();
    assert.equal(await read('#metric-total'),'R$ 0,00');
    assert.equal(await read('#account-name'),'Matheus QA');
    assert.equal(await evaluate("document.querySelectorAll('#expense-category option').length"),9);
  });
  await test('first login tour is short, skippable and saved on the account',async () => {
    await waitFor(() => evaluate("document.querySelector('#tour-dialog').open"),'first tour');
    await screenshot('tour-desktop.png');
    assert.ok((await read('#tour-counter')).includes('1 DE 5'));
    await click('#tour-next'); assert.ok((await read('#tour-counter')).includes('2 DE 5'));
    await click('#tour-back'); assert.ok((await read('#tour-counter')).includes('1 DE 5'));
    await click('#tour-skip'); await waitFor(() => evaluate("!document.querySelector('#tour-dialog').open"),'skip saved');
    assert.equal(await evaluate("FinantoAPI.request('session').then(session => session.user.tourCompleted)"),true);
    await reload(); await loggedIn();
    assert.equal(await evaluate("document.querySelector('#tour-dialog').open"),false);
  });
  let customId;
  const customLabel = 'Transporte <urbano> "QA"';
  await test('inline custom category creates, selects, escapes text and rejects duplicates',async () => {
    await click('#add-expense'); await field('#expense-name','Passe mensal'); await field('#expense-amount','100,00');
    await field('#expense-date','2026-01-31'); await field('#expense-category','__create__');
    assert.equal(await evaluate("document.querySelector('#new-category-fields').hidden"),false);
    await field('#new-category-name',customLabel); await click('#create-category');
    customId = await evaluate("document.querySelector('#expense-category').value");
    assert.ok(customId.startsWith('custom-'));
    assert.equal(await evaluate("document.querySelector('#expense-name').value"),'Passe mensal');
    await field('#expense-category','__create__'); await field('#new-category-name',customLabel.toUpperCase());
    await click('#create-category');
    assert.equal(await evaluate("document.querySelector('#category-error').hidden"),false);
    await click('#cancel-category');
    await field('#expense-is-installment',true); await field('#expense-installments','3'); await click('#save-expense'); await synced();
    assert.equal(await read('#metric-total'),'R$ 33,34');
    assert.equal((await state()).customCategories.length,1);
    assert.ok((await read('#category-legend')).includes(customLabel));
    assert.equal(await evaluate("document.querySelectorAll('urbano').length"),0);
  });
  await test('custom installments, filters, search and persistence across months',async () => {
    await click('[data-month="2026-02"]'); await synced();
    assert.equal(await read('#metric-total'),'R$ 33,33'); assert.ok((await read('#expense-rows')).includes('28 fev.'));
    await click('[data-month="2026-03"]'); await synced();
    assert.equal(await read('#metric-total'),'R$ 33,33'); assert.ok((await read('#expense-rows')).includes('31 mar.'));
    await reload(); await loggedIn(); assert.equal(await read('#metric-total'),'R$ 33,33');
    await click('#category-filters [data-category="'+customId+'"]'); await field('#search-expenses','passe'); await synced();
    assert.equal(await evaluate("document.querySelectorAll('#expense-rows tr').length"),1);
    await field('#search-expenses','inexistente'); await synced();
    assert.equal(await evaluate("document.querySelectorAll('#expense-rows tr').length"),0);
    await click('#clear-filters'); await synced();
  });
  await test('budgets, planning, edit and deletion keep the account consistent',async () => {
    await click('#set-budget'); await field('#budget-amount','200,00'); await click('#budget-form button[type="submit"]'); await synced();
    assert.equal(await read('#metric-budget'),'R$ 166,67');
    await click('[data-view="planning"]'); await synced();
    assert.equal(await evaluate("document.querySelectorAll('.planning-card').length"),6);
    await click('[data-view="overview"]'); await synced();
    const expenseId = (await state()).expenses[0].id;
    await click('[data-edit="'+expenseId+'"]'); await field('#expense-amount','120,00'); await field('#expense-installments','4');
    await click('#save-expense'); await synced(); assert.equal(await read('#metric-total'),'R$ 30,00');
    await click('[data-month="2026-04"]'); await synced(); assert.equal(await read('#metric-total'),'R$ 30,00');
    await addExpense({name:'Excluir teste',amount:'10,00',category:'mercado',date:'2026-04-01'}); await synced();
    const removeId = (await state()).expenses.find(item => item.name === 'Excluir teste').id;
    await click('[data-delete="'+removeId+'"]'); await click('#confirm-action'); await synced();
    assert.equal((await state()).expenses.length,1);
  });
  let backupFile;
  await test('chat saves Pix, clarifies installments, corrects, reports and updates the real dashboard',async () => {
    const before = (await state()).expenses;
    async function message(text) {
      await field('#chat-input',text); await click('#chat-send');
      await waitFor(() => evaluate("!document.querySelector('#chat-send').disabled"),'chat response');
      assert.equal(await evaluate("document.querySelector('#chat-error').hidden"),true,await read('#chat-error'));
    }
    await waitFor(() => evaluate("!document.querySelector('#chat-dialog').hidden && !document.querySelector('#chat-send').disabled"),'chat opens automatically');
    assert.equal(await evaluate("document.querySelector('#chat-dialog').tagName"),'SECTION');
    assert.equal(await evaluate("document.querySelector('#app-shell').inert"),false);
    await field('#chat-input','Meu rascunho de conversa');
    await click('#close-chat');
    assert.equal(await evaluate("document.querySelector('#chat-dialog').hidden"),true);
    assert.equal(await evaluate("document.querySelector('#restore-chat').hidden"),false);
    await click('#restore-chat');
    assert.equal(await evaluate("document.querySelector('#chat-input').value"),'Meu rascunho de conversa');
    await click('[data-view="expenses"]');
    assert.equal(await evaluate("document.querySelector('#chat-dialog').hidden"),false);
    assert.equal(await evaluate("document.querySelector('#chart-grid').hidden"),true);
    await click('[data-view="overview"]');
    await message('Gastei 85,90 no mercado via Pix em 01/04/2026');
    assert.equal((await state()).expenses.length,before.length+1);
    assert.equal((await state()).expenses.at(-1).paymentMethod,'pix');
    await message('Desfazer último gasto'); assert.deepEqual((await state()).expenses,before);
    await message('Comprei uma cadeira por 100 em 3 vezes em 01/04/2026');
    assert.ok((await read('#chat-history')).includes('Qual é a categoria?'));
    assert.equal((await state()).expenses.length,before.length);
    await message('Online');
    await message('Corrigir último gasto: valor 300');
    assert.equal((await state()).expenses.at(-1).totalCents,30000);
    await message('Relatório de abril de 2026');
    assert.ok((await read('#chat-history')).includes('130,00'));
    assert.equal(await evaluate("document.querySelectorAll('.chat-report-row').length"),2);
    await screenshot('chat-desktop.png');
    await click('.chat-report button:last-child');
    await waitFor(() => fs.readdirSync(output).some(file => file.endsWith('.svg')),'chat chart download');
    await click('#close-chat');
    assert.equal(await read('#metric-total'),'R$ 130,00');
    await reload(); await loggedIn();
    await click('#open-chat');
    await waitFor(() => evaluate("!document.querySelector('#chat-send').disabled"),'chat reloaded');
    assert.ok((await read('#chat-history')).includes('Corrigir último gasto'));
    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await screenshot('chat-mobile.png');
    assert.ok(await evaluate("(() => {const r=document.querySelector('#chat-dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()"));
    await message('Desfazer último gasto'); assert.equal((await state()).expenses.at(-1).totalCents,10000);
    await click('#close-chat');
    await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
    const added = (await state()).expenses.find(e => !before.some(old => old.id === e.id));
    await click('[data-delete="'+added.id+'"]'); await click('#confirm-action'); await synced();
    assert.deepEqual((await state()).expenses,before);
  });
  await test('JSON and CSV export plus import preserve custom categories',async () => {
    await click('#export-backup'); await click('#export-csv');
    await waitFor(() => fs.readdirSync(output).some(file => file.endsWith('.json')) && fs.readdirSync(output).some(file => file.endsWith('.csv')), 'downloads');
    backupFile = fs.readdirSync(output).find(file => file.endsWith('.json'));
    const backup = JSON.parse(fs.readFileSync(path.join(output,backupFile),'utf8'));
    assert.equal(backup.customCategories[0].label,customLabel);
    const {root} = await cdp('DOM.getDocument');
    const {nodeId} = await cdp('DOM.querySelector',{nodeId:root.nodeId,selector:'#import-file'});
    await cdp('DOM.setFileInputFiles',{nodeId,files:[path.join(output,backupFile)]});
    await waitFor(() => evaluate("document.querySelector('#confirm-dialog').open"),'import confirmation');
    await click('#confirm-action'); await synced(); assert.equal((await state()).customCategories[0].id,customId);
  });
  await test('logout, incorrect password, second account isolation and later login',async () => {
    await click('#logout'); await loggedOut();
    await field('#login-username','matheus.qa'); await field('#login-password','Senha incorreta 123');
    await click('#login-submit'); await waitFor(() => evaluate("!document.querySelector('#login-submit').disabled"),'login rejection');
    assert.ok((await read('#auth-message')).includes('incorretos'));
    assert.equal(await evaluate("document.querySelector('#app-shell').hidden"),true);
    await register('outra.conta','Outra pessoa'); assert.equal(await read('#metric-total'),'R$ 0,00');
    assert.equal(await evaluate("document.querySelectorAll('#expense-category option').length"),9);
    await click('#logout'); await loggedOut(); await login('matheus.qa');
    assert.equal((await state()).expenses.length,1);
    assert.equal((await state()).customCategories[0].label,customLabel);
  });
  await test('same account in another browser context sees the server data',async () => {
    const response = await fetch(appURL+'/api/login',{method:'POST',headers:{Origin:appURL,'X-Requested-With':'finanto','Content-Type':'application/json'},body:JSON.stringify({username:'matheus.qa',password})});
    assert.equal(response.status,200);
    const session = await response.json(); const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal(session.user.tourCompleted,true);
    const dataResponse = await fetch(appURL+'/api/data',{headers:{Cookie:cookie,'X-Finanto-Account':session.user.id}});
    const data = await dataResponse.json();
    assert.equal(data.data.customCategories[0].label,customLabel);
    assert.equal(data.data.expenses[0].totalCents,12000);
  });
  await test('login in another tab renews the first tabs CSRF token automatically',async () => {
    await inAnotherTab(`FinantoAPI.request('login',{method:'POST',body:{username:'matheus.qa',password:${JSON.stringify(password)}}})`);
    await field('#search-expenses','passe'); await synced();
    assert.equal((await state()).preferences.search,'passe');
    await click('#clear-filters'); await synced();
  });
  await test('demo remains separate from the real account',async () => {
    const before = (await state()).expenses;
    await click('#start-demo');
    await waitFor(() => evaluate("!document.querySelector('#demo-notice').hidden"),'demo');
    assert.equal(await evaluate("document.querySelector('#donut-count').textContent"),'7');
    await screenshot('dashboard-desktop.png');
    await click('#exit-demo'); await synced(); assert.deepEqual((await state()).expenses,before);
  });
  await test('mobile category creation and access screen fit the viewport',async () => {
    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await sleep(300);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"),true);
    await click('#replay-tour');
    await screenshot('tour-mobile.png');
    assert.ok(await evaluate("(() => {const r=document.querySelector('#tour-dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()"));
    await click('#tour-next'); await click('#tour-next'); await click('#tour-next'); await click('#tour-next');
    assert.ok((await read('#tour-counter')).includes('5 DE 5'));
    assert.ok((await read('#tour-description')).includes('minimizar'));
    await screenshot('tour-chat-mobile.png');
    await click('#tour-create');
    await waitFor(() => evaluate("document.querySelector('#expense-dialog').open"),'tour opens real expense form');
    await click('[data-close="expense-dialog"]');
    await click('#add-expense'); await field('#expense-category','__create__');
    await field('#new-category-name','Educação');
    await screenshot('category-mobile.png');
    assert.ok(await evaluate("(() => {const r=document.querySelector('#expense-dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()"));
    await click('#cancel-category'); await click('[data-close="expense-dialog"]'); await synced();
    await click('#logout'); await loggedOut(); await screenshot('login-mobile.png');
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"),true);
    assert.equal(await evaluate("document.querySelector('#app-shell').inert"),true);
    assert.equal(await evaluate("document.querySelector('#chat-dialog').hidden"),true);
    assert.equal(await evaluate("document.querySelector('#restore-chat').hidden"),true);
  });
  await test('email recovery opens a clean link, validates confirmation and changes the password without losing data',async () => {
    await click('#show-forgot'); await field('#forgot-email','matheus.qa@example.com');
    await click('#forgot-submit');
    await waitFor(() => evaluate("!document.querySelector('#forgot-submit').disabled"),'forgot request');
    await waitFor(() => recoveryMessages.length === 1,'isolated recovery message');
    assert.ok((await read('#auth-message')).includes('Se existir uma conta'));
    await screenshot('recovery-mobile.png');
    const link = recoveryMessages[0].url;
    // Same-document navigation exercises email links opened in an already loaded tab.
    await cdp('Page.navigate',{url:link});
    await waitFor(() => evaluate("!document.querySelector('#reset-form').hidden"),'reset form');
    assert.equal(await evaluate('location.hash'),'');
    await field('#reset-password','Nova123!'); await field('#reset-confirm','Outra123!');
    await click('#reset-submit'); assert.ok((await read('#auth-message')).includes('não coincidem'));
    await field('#reset-confirm','Nova123!'); await click('#reset-submit');
    await waitFor(() => evaluate("!document.querySelector('#login-form').hidden && !document.querySelector('#login-submit').disabled"),'reset complete');
    assert.ok((await read('#auth-message')).includes('Senha atualizada'));
    await field('#login-username','matheus.qa'); await field('#login-password','Nova123!');
    await click('#login-submit'); await loggedIn();
    assert.equal((await state()).expenses.length,1);
    assert.equal(await evaluate("document.querySelector('#tour-dialog').open"),false);
    await click('#logout'); await loggedOut();
    await cdp('Page.navigate',{url:link});
    await waitFor(() => evaluate("!document.querySelector('#reset-form').hidden"),'used link reset form');
    await field('#reset-password','Nova456!'); await field('#reset-confirm','Nova456!');
    await click('#reset-submit');
    await waitFor(() => evaluate("!document.querySelector('#reset-submit').disabled"),'used link rejection');
    assert.ok((await read('#auth-message')).includes('expirou ou já foi utilizado'));
    await click('#reset-resend'); assert.equal(await evaluate("document.querySelector('#forgot-form').hidden"),false);
    await click('#back-login');
    await click('#show-register'); await screenshot('register-mobile.png'); await click('#show-login');
  });
  await test('no JavaScript exceptions or asset errors',async () => {
    const errors = pageErrors.filter(error => !((error.url?.includes('/api/login') && error.text?.includes('401')) || (error.url?.includes('/api/data') && error.text?.includes('403')) || (error.url?.includes('/api/reset-password') && error.text?.includes('400'))));
    assert.deepEqual(errors,[]);
  });
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({failures,pageErrors,output},null,2));
  console.log('ARTIFACTS '+output); console.log(failures.length ? 'RESULT '+failures.length+' failed' : 'RESULT all passed');
  if (failures.length) process.exitCode=1;
})().catch(error => {console.error(error); console.error('ARTIFACTS '+output); process.exitCode=1;}).finally(async () => {
  if (socket?.readyState === WebSocket.OPEN) {
    try {await cdp('Browser.close');} catch {}
    socket.close();
  }
  edge?.kill();
  if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
});
