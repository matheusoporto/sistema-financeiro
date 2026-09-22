/* Orçaviva — Painel, categorias e acesso à conta. */
(() => {
  'use strict';

  const F = window.Finance;
  const API = window.FinantoAPI;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const LEGACY_KEY = 'finanto.data.v1';
  let MAIN_KEY = '';
  let DEMO_KEY = '';
  let MODE_KEY = '';
  let currentUser = null;
  let accountStore = null;
  let syncInterval = null;
  let authBusy = false;
  let resetToken = '';
  let authGeneration = 0;
  let previousCategory = '';
  const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const PAGE_SIZE = 8;
  const MAX_BACKUP_BYTES = 8 * 1024 * 1024 - 1024;
  function validateState(data) {
    const normalized = F.validateBackup(data);
    if (new TextEncoder().encode(JSON.stringify(normalized)).length > MAX_BACKUP_BYTES) throw new Error('Os dados excedem o limite de 8 MB da conta. Exporte um backup antes de reduzir o histórico.');
    return normalized;
  }
  const icons = {
    wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v11H5a3 3 0 0 1-3-3V6"/><path d="M20 12h-5v4h5M17 14h.01"/>',
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    receipt: '<path d="M5 3l2 1 2-1 3 1 3-1 2 1 2-1v18l-2-1-2 1-3-1-3 1-2-1-2 1zM9 8h6M9 12h6M9 16h3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    sprout: '<path d="M12 21v-8C5 14 2 9 3 4c6-1 10 2 9 9 0-7 4-10 9-9 0 6-3 9-9 9M7 8l5 5m5-5-5 5"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    'chevron-left': '<path d="m14 6-6 6 6 6"/>',
    'chevron-right': '<path d="m10 6 6 6-6 6"/>',
    sliders: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    layers: '<path d="m12 3 10 5-10 5L2 8zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    'shopping-bag': '<path d="M5 7h14l2 14H3zM8 8V6a4 4 0 0 1 8 0v2"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM21 2v4M19 4h4"/>',
    pie: '<path d="M21 12a9 9 0 1 1-9-9v9zM16 3.5a8 8 0 0 1 4.5 4.5H16z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    'filter-x': '<path d="M4 3h16l-6 7v10l-4-2v-8zM17 14l5 5m0-5-5 5"/>',
    sort: '<path d="M8 4v16m-3-3 3 3 3-3M16 20V4m-3 3 3-3 3 3"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    logout: '<path d="M9 3H4v18h5M10 12h11m-4-4 4 4-4 4"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    edit: '<path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15z"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    ifood: '<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M18 3c-4 4-4 9 0 9h2V3h-2v18"/>',
    online: '<path d="M2 3h3l3 13h11l3-9H6"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>',
    restaurantes: '<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M18 3c-4 4-4 9 0 9h2V3h-2v18"/>',
    mercado: '<path d="m3 9 2 12h14l2-12zM2 9h20M8 9l4-7 4 7M9 13v4M15 13v4"/>',
    farmacia: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 7v10M7 12h10"/>',
    assinaturas: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
    lazer: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  };
  function icon(name) { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.receipt}</svg>`; }
  function escape(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
  function currency(value) { return F.formatCurrency(value); }
  function categories(customCategories = state.customCategories) { return F.getCategories(customCategories || []); }
  function category(id, customCategories = state.customCategories) { return categories(customCategories).find((item) => item.id === id); }
  function summarize(entries) { return F.summarize(entries,state.customCategories); }
  function monthLabel(month, short = false) { return new Date(`${month}-02T12:00:00`).toLocaleDateString('pt-BR', {month:short ? 'short' : 'long', year:'numeric'}); }
  function capitalize(text) { return text.charAt(0).toUpperCase() + text.slice(1); }
  function plainMoney(cents) { return (cents / 100).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}); }
  const initialPreferences = () => ({month:F.todayISO().slice(0,7), view:'overview', category:'all', search:'', sort:'date', direction:'desc', page:1});
  const blankState = () => ({version:1, expenses:[], budgets:{}, customCategories:[], preferences:initialPreferences()});
  let demoMode = false;
  let recoveryRaw = null;
  let storageError = '';
  let pendingConfirmation = null;
  let pendingExternalState = null;
  let budgetMonth = '';
  let allEntries = [];
  let monthEntries = [];
  let filteredEntries = [];

  function normalizePreferences(data) {
    const defaults = initialPreferences();
    const p = data.preferences || {};
    data.preferences = {...defaults,
      month:typeof p.month === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(p.month) ? p.month : defaults.month,
      view:['overview','expenses','planning'].includes(p.view) ? p.view : defaults.view,
      category:p.category === 'all' || category(p.category,data.customCategories || []) ? p.category : 'all',
      search:typeof p.search === 'string' ? p.search.slice(0,100) : '',
      sort:['name','date','amount'].includes(p.sort) ? p.sort : 'date',
      direction:p.direction === 'asc' ? 'asc' : 'desc',
      page:Number.isInteger(p.page) && p.page > 0 ? p.page : 1,
    };
    if (p.draft && typeof p.draft === 'object' && !Array.isArray(p.draft)) {
      data.preferences.draft = Object.fromEntries(['name','amount','category','date','installments','notes'].map((key) => [key, typeof p.draft[key] === 'string' ? p.draft[key].slice(0,500) : '']));
      data.preferences.draft.isInstallment = p.draft.isInstallment === true;
    }
    return data;
  }
  function loadState(key) {
    recoveryRaw = null;
    storageError = '';
    let raw;
    try { raw = localStorage.getItem(key); }
    catch { storageError = 'O navegador bloqueou o armazenamento. Seus dados ficarão nesta sessão; exporte um backup antes de sair.'; return blankState(); }
    if (!raw) return blankState();
    try { return normalizePreferences(F.validateBackup(JSON.parse(raw))); }
    catch {
      recoveryRaw = raw;
      try { localStorage.setItem(`${key}.recovery.${Date.now()}`, raw); }
      catch { /* A cópia em memória segue disponível para download. */ }
      storageError = 'Os dados salvos não puderam ser lidos. Baixe a cópia de recuperação antes de continuar.';
      return blankState();
    }
  }
  let state = blankState();
  const prefs = () => state.preferences;

  function showStorageStatus() {
    const warning = $('#storage-warning');
    if (!demoMode && accountStore) {
      const status = accountStore.status;
      const problem = ['error','conflict'].includes(status.kind);
      warning.hidden = !problem && !status.localError;
      warning.textContent = problem ? status.message : status.localError || '';
      if (problem) {
        const backup = document.createElement('button'); backup.className = 'text-button'; backup.textContent = 'Baixar alterações pendentes';
        backup.onclick = () => download(JSON.stringify(accountStore.data || state,null,2),'orcaviva-alteracoes-pendentes.json','application/json');
        warning.append(backup);
        const retry = document.createElement('button'); retry.className = 'text-button';
        retry.textContent = status.kind === 'conflict' ? 'Carregar versão do servidor' : 'Tentar salvar novamente';
        retry.onclick = () => status.kind === 'conflict' ? resolveSyncConflict() : accountStore.flush().catch((error) => toast(error.message,true));
        warning.append(retry);
      }
      $('#save-status').innerHTML = `${problem ? icon('info') : '<span class="status-dot"></span>'}${escape(status.message)}`;
      $('#save-status').classList.toggle('save-error',problem);
      return;
    }
    warning.hidden = !storageError;
    warning.textContent = storageError;
    if (recoveryRaw) {
      const button = document.createElement('button');
      button.className = 'text-button'; button.textContent = 'Baixar cópia e continuar';
      button.onclick = () => { download(recoveryRaw, 'orcaviva-recuperacao.json', 'application/json'); recoveryRaw = null; persist(); toast('Cópia exportada. O salvamento automático está ativo novamente.'); };
      warning.append(button);
    }
    $('#save-status').innerHTML = storageError ? `${icon('info')}Salvamento requer atenção` : '<span class="status-dot"></span>Demonstração salva no navegador';
    $('#save-status').classList.toggle('save-error', Boolean(storageError));
  }
  function persist() {
    if (!currentUser || pendingExternalState || accountStore?.conflict) return;
    if (!demoMode) { accountStore.save(state); return; }
    try {
      if (recoveryRaw) throw new Error('recovery');
      localStorage.setItem(demoMode ? DEMO_KEY : MAIN_KEY, JSON.stringify(state));
      localStorage.setItem(MODE_KEY, String(demoMode));
      storageError = '';
    } catch (error) {
      if (error.message !== 'recovery') storageError = 'Não foi possível salvar no navegador. Exporte um backup para proteger suas alterações e verifique o espaço disponível.';
    }
    showStorageStatus();
  }
  function toast(message, isError = false) {
    const node = document.createElement('div');
    node.className = `toast${isError ? ' toast-error' : ''}`;
    node.innerHTML = `<span class="toast-icon">${icon(isError ? 'info' : 'check')}</span><span class="toast-message">${escape(message)}</span><button class="toast-close icon-button" aria-label="Dispensar notificação">${icon('x')}</button>`;
    node.querySelector('button').onclick = () => node.remove();
    $('#toast-region').replaceChildren(node);
    setTimeout(() => node.remove(), 5500);
  }
  function mutatePreferences(values) { Object.assign(prefs(), values); render(); persist(); }
  function selectMonth(month) { mutatePreferences({month, page:1}); $('#month-tabs .active')?.scrollIntoView({block:'nearest', inline:'nearest'}); }

  function renderMonths() {
    const [year, month] = prefs().month.split('-');
    const usedMonths = new Set(allEntries.map((entry) => entry.month));
    $('#selected-year').textContent = year;
    $('#previous-year').disabled = Number(year) <= 1;
    $('#next-year').disabled = Number(year) >= 9999;
    $('#month-tabs').innerHTML = MONTHS.map((label, index) => {
      const key = `${year}-${String(index+1).padStart(2,'0')}`;
      const active = Number(month) === index + 1;
      return `<button class="month-tab${active ? ' active' : ''}${usedMonths.has(key) ? ' has-expenses' : ''}" data-month="${key}" role="tab" aria-selected="${active}" aria-label="${escape(monthLabel(key))}" tabindex="${active ? 0 : -1}">${label}<span class="month-dot"></span></button>`;
    }).join('');
    $('#current-month').hidden = prefs().month === F.todayISO().slice(0,7);
    $('#period-title').textContent = capitalize(monthLabel(prefs().month));
    $('#period-subtitle').textContent = monthEntries.length ? `${monthEntries.length} lançamento${monthEntries.length === 1 ? '' : 's'} · Cada detalhe faz a diferença.` : 'Vamos fazer este mês valer a pena.';
  }
  function renderSummary(summary) {
    $('#metric-total').textContent = currency(summary.totalCents);
    const previousMonth = prefs().month === '0001-01' ? null : F.addMonths(prefs().month,-1);
    const previous = summarize(allEntries.filter((entry) => entry.month === previousMonth));
    let comparison = '<span class="neutral">Seu ponto de partida</span>';
    if (previous.totalCents > 0) {
      const percent = (summary.totalCents - previous.totalCents) / previous.totalCents * 100;
      comparison = `<span class="${percent > 0 ? 'negative' : 'positive'}">${percent > 0 ? '↗' : percent < 0 ? '↘' : '→'} ${Math.abs(percent).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</span><span>vs. mês anterior</span>`;
    } else if (summary.totalCents) comparison = '<span class="neutral">Sem gastos no mês anterior</span>';
    $('#metric-comparison').innerHTML = comparison;
    $('#metric-installments').textContent = currency(summary.installmentCents);
    $('#metric-installment-detail').textContent = summary.installmentCount ? `${summary.installmentCount} compra${summary.installmentCount === 1 ? '' : 's'} parcelada${summary.installmentCount === 1 ? '' : 's'} neste mês` : 'Nenhuma parcela por aqui';
    $('#metric-largest').textContent = currency(summary.largestEntry?.amountCents || 0);
    $('#metric-largest-name').textContent = summary.largestEntry ? summary.largestEntry.name + (summary.largestEntry.installments > 1 ? ` · parcela ${summary.largestEntry.installmentNumber}/${summary.largestEntry.installments}` : '') : 'Seus gastos aparecerão aqui';
    $('#metric-largest-name').title = $('#metric-largest-name').textContent;
    const budget = state.budgets[prefs().month];
    const hasBudget = Number.isInteger(budget);
    const remaining = hasBudget ? budget - summary.totalCents : 0;
    $('#metric-budget').textContent = hasBudget ? currency(remaining) : 'A definir';
    $('#metric-budget').classList.toggle('danger-text', hasBudget && remaining < 0);
    const progress = hasBudget ? budget > 0 ? summary.totalCents / budget * 100 : summary.totalCents > 0 ? 100 : 0 : 0;
    $('#budget-progress-bar').style.width = `${Math.min(100,progress)}%`;
    $('#budget-progress-bar').classList.toggle('over-budget', remaining < 0);
    $('#metric-budget-detail').textContent = hasBudget ? remaining < 0 ? `${currency(-remaining)} acima do orçamento` : `${progress.toLocaleString('pt-BR',{maximumFractionDigits:0})}% de ${currency(budget)} utilizado` : 'Defina uma meta para o seu mês';
    $('#set-budget').innerHTML = `${icon('sliders')}${hasBudget ? 'Ajustar' : 'Definir'} orçamento`;
  }
  function renderTrend(summary) {
    const [year, month] = prefs().month.split('-').map(Number);
    const endOfMonth = new Date(`${prefs().month}-01T12:00:00`);
    endOfMonth.setMonth(endOfMonth.getMonth()+1,0);
    const days = endOfMonth.getDate();
    const daily = Array(days).fill(0);
    monthEntries.forEach((entry) => { daily[Number(entry.date.slice(8,10))-1] += entry.amountCents; });
    let running = 0;
    const cumulative = daily.map((amount) => (running += amount));
    const max = Math.max(10000, summary.totalCents * 1.18);
    const left = 60, right = 594, top = 16, bottom = 180;
    const x = (index) => left + index / (days-1) * (right-left);
    const y = (value) => bottom - value / max * (bottom-top);
    const points = cumulative.map((value,index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`);
    const lines = [0,1,2,3].map((step) => {
      const value = max / 3 * step;
      const label = (value/100).toLocaleString('pt-BR',{maximumFractionDigits:0});
      return `<line class="chart-grid-line" x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}"/><text class="chart-axis-label" x="${left-12}" y="${y(value)+4}" text-anchor="end">${label}</text>`;
    }).join('');
    const ticks = [1,5,10,15,20,25,days].filter((value,index,array) => array.indexOf(value) === index).map((day) => `<text class="chart-axis-label" x="${x(day-1)}" y="205" text-anchor="middle">${String(day).padStart(2,'0')}</text>`).join('');
    const dots = daily.map((amount,index) => amount ? `<circle class="chart-point" cx="${x(index)}" cy="${y(cumulative[index])}" r="3"><title>${index+1}/${String(month).padStart(2,'0')} — Gastos: ${escape(currency(amount))}; acumulado: ${escape(currency(cumulative[index]))}</title></circle>` : '').join('');
    $('#trend-chart').innerHTML = `<svg viewBox="0 0 620 218" role="img" aria-label="Gastos acumulados em ${escape(monthLabel(prefs().month))}: ${escape(currency(summary.totalCents))}. Valores do eixo em reais."><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#83bda0" stop-opacity=".3"/><stop offset="100%" stop-color="#83bda0" stop-opacity=".015"/></linearGradient></defs>${lines}${ticks}${summary.totalCents ? `<path class="chart-area" fill="url(#chart-fill)" d="M${left},${bottom} L${points.join(' L')} L${right},${bottom} Z"/><polyline class="chart-line" points="${points.join(' ')}"/>${dots}` : `<line x1="${left}" x2="${right}" y1="${bottom-1}" y2="${bottom-1}" stroke="#b9d1c4" stroke-width="2" stroke-dasharray="5 5"/><text class="chart-empty-label" x="335" y="98" text-anchor="middle">Seu mês ganha forma a cada gasto.</text>`}</svg>`;
    const largest = summary.largestEntry;
    $('#chart-insight').innerHTML = `${icon('sparkles')}<p>${largest ? `Sua maior compra no mês foi <strong>${escape(largest.name)}</strong>: ${escape(currency(largest.amountCents))}${largest.installments > 1 ? ` (parcela ${largest.installmentNumber}/${largest.installments})` : ''}.` : 'Cada lançamento ajuda você a enxergar melhor seus hábitos.'}</p>`;
  }
  function renderCategories(summary) {
    let start = 0;
    const segments = summary.byCategory.map((item) => { const end = start + item.totalCents / summary.totalCents * 100; const segment = `${item.color} ${start}% ${end}%`; start = end; return segment; });
    $('#donut-chart').style.background = segments.length ? `conic-gradient(${segments.join(',')})` : 'conic-gradient(#e6ece8 0% 100%)';
    $('#donut-chart').setAttribute('aria-label', summary.byCategory.length ? summary.byCategory.map((item) => `${item.label}: ${currency(item.totalCents)}`).join('; ') : 'Nenhuma despesa neste mês');
    $('#donut-count').textContent = summary.byCategory.length;
    $('#donut-label').textContent = summary.byCategory.length === 1 ? 'categoria' : 'categorias';
    const items = summary.byCategory.length ? summary.byCategory : categories().map((item) => ({...item,totalCents:0}));
    $('#category-legend').innerHTML = items.map((item) => `<button class="legend-row" data-category="${item.id}" title="Ver gastos de ${escape(item.label)}"><span class="legend-dot" style="background:${item.color}"></span><span class="legend-name">${escape(item.label)}</span><span class="legend-value">${currency(item.totalCents)}</span><span class="legend-percent">${summary.totalCents ? Math.round(item.totalCents / summary.totalCents * 100) : 0}%</span></button>`).join('');
    const largest = summary.byCategory[0];
    $('#category-insight').innerHTML = largest ? `<span class="legend-dot" style="background:${largest.color}"></span><strong>${escape(largest.label)}</strong> representa ${Math.round(largest.totalCents / summary.totalCents * 100)}% dos seus gastos.` : 'Um mês em branco, cheio de possibilidades.';
  }
  function renderFilters() {
    const counts = Object.fromEntries(categories().map((item) => [item.id,0]));
    monthEntries.forEach((entry) => counts[entry.category]++);
    const filters = [{id:'all',label:'Todos'}, ...categories()];
    $('#category-filters').innerHTML = filters.map((item) => `<button class="category-filter${prefs().category === item.id ? ' active' : ''}" data-category="${item.id}" aria-pressed="${prefs().category === item.id}">${item.id !== 'all' ? `<span class="filter-dot" style="background:${item.color}"></span>` : ''}${escape(item.label)}${item.id === 'all' ? `<span class="filter-count">${monthEntries.length}</span>` : ''}</button>`).join('');
    if ($('#search-expenses').value !== prefs().search) $('#search-expenses').value = prefs().search;
    $('#clear-filters').hidden = prefs().category === 'all' && !prefs().search;
  }
  const normalizeSearch = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  function renderTransactions() {
    const query = normalizeSearch(prefs().search.trim());
    filteredEntries = monthEntries.filter((entry) => (prefs().category === 'all' || entry.category === prefs().category) && (!query || normalizeSearch(`${entry.name} ${entry.notes}`).includes(query)));
    filteredEntries.sort((a,b) => {
      const value = prefs().sort === 'amount' ? a.amountCents - b.amountCents : prefs().sort === 'name' ? a.name.localeCompare(b.name,'pt-BR') : a.date.localeCompare(b.date);
      return (prefs().direction === 'asc' ? 1 : -1) * value || a.name.localeCompare(b.name,'pt-BR');
    });
    const pages = Math.max(1,Math.ceil(filteredEntries.length / PAGE_SIZE));
    prefs().page = Math.min(pages,prefs().page);
    const offset = (prefs().page-1) * PAGE_SIZE;
    const visible = filteredEntries.slice(offset,offset+PAGE_SIZE);
    $('#transaction-count').textContent = monthEntries.length;
    $('#expense-rows').innerHTML = visible.map((entry) => {
      const cat = category(entry.category);
      return `<tr><td><div class="expense-cell"><span class="expense-icon" style="--category-color:${cat.color}">${icon(cat.icon)}</span><div><button class="expense-name-button" data-edit="${escape(entry.expenseId)}">${escape(entry.name)}</button><span class="expense-note">${escape(entry.notes || (entry.installments > 1 ? `Compra de ${currency(entry.totalCents)}` : 'À vista, tudo certo'))}</span></div></div></td><td><span class="category-pill" style="--category-color:${cat.color}">${escape(cat.label)}</span></td><td class="date-cell">${entry.date.slice(8,10)} ${MONTHS[Number(entry.date.slice(5,7))-1].toLowerCase()}.</td><td><span class="payment-tag${entry.installments > 1 ? ' is-installment' : ''}">${entry.installments > 1 ? `${icon('layers')}${entry.installmentNumber} de ${entry.installments}` : 'À vista'}</span></td><td class="amount-column"><strong>${currency(entry.amountCents)}</strong></td><td><div class="row-actions"><button class="icon-button" data-edit="${escape(entry.expenseId)}" aria-label="Editar ${escape(entry.name)}" title="Editar compra">${icon('edit')}</button><button class="icon-button delete-button" data-delete="${escape(entry.expenseId)}" aria-label="Excluir ${escape(entry.name)}" title="Excluir compra e todas as parcelas">${icon('trash')}</button></div></td></tr>`;
    }).join('');
    visible.forEach((entry,index) => {
      if (!entry.paymentMethod) return;
      const payment = document.createElement('small'); payment.className = 'expense-note';
      payment.textContent = ({pix:'Pix',credito:'Crédito',debito:'Débito',dinheiro:'Dinheiro',boleto:'Boleto'})[entry.paymentMethod];
      $('#expense-rows').children[index].children[3].append(payment);
    });
    $('#empty-state').hidden = visible.length > 0;
    const filtered = prefs().category !== 'all' || Boolean(query);
    $('#empty-state h3').textContent = filtered ? 'Nenhum gasto encontrado' : 'Um mês pronto para começar';
    $('#empty-state p').textContent = filtered ? 'Tente outra busca ou escolha uma categoria diferente.' : 'Do cafezinho à próxima conquista, organize tudo por aqui.';
    $('#empty-add').innerHTML = filtered ? `${icon('filter-x')}Limpar filtros` : `${icon('plus')}Adicionar meu primeiro gasto`;
    $('#empty-add').dataset.clear = String(filtered);
    $('#filtered-total').textContent = currency(summarize(filteredEntries).totalCents);
    $('#table-result-count').textContent = filteredEntries.length ? `${offset+1}–${offset+visible.length} de ${filteredEntries.length} lançamento${filteredEntries.length === 1 ? '' : 's'}` : 'Nenhum gasto para exibir';
    $('#pagination').innerHTML = pages > 1 ? `<button class="icon-button" data-page="${prefs().page-1}" ${prefs().page === 1 ? 'disabled' : ''} aria-label="Página anterior">${icon('chevron-left')}</button><span>${prefs().page} / ${pages}</span><button class="icon-button" data-page="${prefs().page+1}" ${prefs().page === pages ? 'disabled' : ''} aria-label="Próxima página">${icon('chevron-right')}</button>` : '';
    $$('[data-sort]').forEach((button) => { button.closest('th').setAttribute('aria-sort',button.dataset.sort === prefs().sort ? prefs().direction === 'asc' ? 'ascending' : 'descending' : 'none'); });
    $('#export-csv').disabled = !filteredEntries.length;
  }
  function renderPlanning() {
    const [selectedYear,selectedMonth] = prefs().month.split('-').map(Number);
    const remainingMonths = (10000-selectedYear)*12-selectedMonth+1;
    $('#planning-grid').innerHTML = Array.from({length:Math.min(6,remainingMonths)},(_,index) => {
      const month = F.addMonths(prefs().month,index);
      const entries = allEntries.filter((entry) => entry.month === month);
      const summary = summarize(entries);
      const budget = state.budgets[month];
      const hasBudget = Number.isInteger(budget);
      const progress = hasBudget ? budget ? Math.min(100,summary.totalCents/budget*100) : summary.totalCents ? 100 : 0 : 0;
      return `<article class="planning-card${index === 0 ? ' current' : ''}"><div class="planning-card-top"><h4>${escape(capitalize(monthLabel(month)))}</h4>${icon('calendar')}</div><strong class="planning-amount">${currency(summary.totalCents)}</strong><p class="planning-detail">${currency(summary.installmentCents)} em parcelas</p><div class="planning-progress"><span class="${hasBudget && summary.totalCents > budget ? 'over-budget' : ''}" style="width:${progress}%"></span></div><p class="planning-detail">${hasBudget ? `${currency(budget-summary.totalCents)} ${summary.totalCents > budget ? '(acima do limite)' : 'disponíveis'}` : 'Orçamento ainda não definido'}</p><div class="planning-card-footer"><button class="text-button" data-plan-month="${month}">Ver mês ${icon('arrow-right')}</button><button class="icon-button" data-budget-month="${month}" aria-label="Definir orçamento de ${escape(monthLabel(month))}" title="Ajustar orçamento">${icon('sliders')}</button></div></article>`;
    }).join('');
    const commitments = state.expenses.filter((expense) => expense.installments > 1).map((expense) => {
      const remaining = allEntries.filter((entry) => entry.expenseId === expense.id && entry.month >= prefs().month);
      return {expense, remaining, total:remaining.reduce((sum,entry) => sum+entry.amountCents,0)};
    }).filter((item) => item.remaining.length).sort((a,b) => b.total-a.total);
    $('#commitments-list').innerHTML = commitments.length ? commitments.map(({expense,remaining,total}) => `<div class="commitment-row"><span class="expense-icon" style="--category-color:${category(expense.category).color}">${icon(category(expense.category).icon)}</span><div class="commitment-info"><button class="expense-name-button" data-edit="${escape(expense.id)}">${escape(expense.name)}</button><span>${remaining.length} parcela${remaining.length > 1 ? 's' : ''} · até ${escape(monthLabel(remaining[remaining.length-1].month,true))}</span></div><div class="commitment-amount"><strong>${currency(total)}</strong><span>comprometidos</span></div></div>`).join('') : '<div class="empty-state compact"><h3>O futuro está livre por aqui.</h3><p>Quando você parcelar uma compra, poderá acompanhar os próximos pagamentos neste espaço.</p></div>';
  }
  function render() {
    if (!currentUser) return;
    allEntries = F.buildEntries(state.expenses);
    monthEntries = allEntries.filter((entry) => entry.month === prefs().month);
    const summary = summarize(monthEntries);
    const view = prefs().view;
    const titles = {overview:['Seu mês, sob controle','Cada gasto no seu lugar. Mais espaço para os seus planos.'],expenses:['Pequenos gastos, visão completa','Encontre, filtre e organize cada detalhe das suas compras.'],planning:['Seu futuro, mais tranquilo','Antecipe suas parcelas. Abra espaço para os próximos planos.']};
    $('#page-title').innerHTML = `${titles[view][0]}<span>.</span>`;
    $('#page-description').textContent = titles[view][1];
    $$('[data-view]').forEach((button) => { button.classList.toggle('active',button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
    $('#expense-count').textContent = state.expenses.length;
    $('#chart-grid').hidden = view !== 'overview';
    $('#transactions-panel').hidden = view === 'planning';
    $('#planning-section').hidden = view !== 'planning';
    $('#welcome-banner').hidden = state.expenses.length > 0 || demoMode || view !== 'overview';
    $('#demo-notice').hidden = !demoMode;
    renderMonths(); renderSummary(summary); renderFilters(); renderTransactions();
    if (view === 'overview') { renderTrend(summary); renderCategories(summary); }
    if (view === 'planning') renderPlanning();
    showStorageStatus();
    renderCategoryOptions();
  }

  function openDialog(id) { const dialog = $(`#${id}`); if (!dialog.open) dialog.showModal(); }
  function captureDraft() { return {name:$('#expense-name').value,amount:$('#expense-amount').value,category:$('#expense-category').value,date:$('#expense-date').value,isInstallment:$('#expense-is-installment').checked,installments:$('#expense-installments').value,notes:$('#expense-notes').value}; }
  function updatePreview() {
    const isInstallment = $('#expense-is-installment').checked;
    $('#installment-fields').hidden = !isInstallment;
    $('#expense-installments').disabled = !isInstallment;
    const preview = $('#installment-preview');
    preview.hidden = true;
    try {
      const total = F.toCents($('#expense-amount').value);
      const count = isInstallment ? Number($('#expense-installments').value) : 1;
      const date = $('#expense-date').value;
      if (!isInstallment || !total || !date || !Number.isInteger(count) || count < 2 || count > 120) return;
      const values = F.allocateInstallments(total,count);
      const min = Math.min(...values), max = Math.max(...values);
      const lastMonth = F.addMonths(date.slice(0,7),count-1);
      preview.innerHTML = `${icon('layers')}<div><strong>${count} parcelas ${min === max ? `de ${currency(min)}` : `de ${currency(min)} a ${currency(max)}`}</strong><span>De ${escape(monthLabel(date.slice(0,7),true))} a ${escape(monthLabel(lastMonth,true))}.</span>${min !== max ? '<small>Os centavos extras ficam nas primeiras parcelas. O total continua exato.</small>' : ''}</div>`;
      preview.hidden = false;
    } catch { /* O formulário apresenta erros ao salvar. */ }
  }
  function openExpense(id) {
    const expense = id ? state.expenses.find((item) => item.id === id) : null;
    if (id && !expense) return;
    const defaultDate = prefs().month === F.todayISO().slice(0,7) ? F.todayISO() : `${prefs().month}-01`;
    const draft = expense ? {name:expense.name,amount:plainMoney(expense.totalCents),category:expense.category,date:expense.date,isInstallment:expense.installments > 1,installments:String(expense.installments),notes:expense.notes} : prefs().draft || {date:defaultDate,installments:'2'};
    $('#expense-form').reset();
    $('#new-category-fields').hidden = true;
    $('#new-category-name').value = '';
    renderCategoryOptions();
    $('#expense-id').value = expense?.id || '';
    for (const key of ['name','amount','category','date','installments','notes']) $(`#expense-${key}`).value = draft[key] || (key === 'date' ? defaultDate : key === 'installments' ? '2' : '');
    $('#expense-is-installment').checked = draft.isInstallment === true;
    previousCategory = $('#expense-category').value;
    $('#expense-dialog-title').textContent = expense ? 'Editar compra' : 'Adicionar um gasto';
    $('#expense-dialog-description').textContent = expense?.installments > 1 ? 'As alterações serão aplicadas a todas as parcelas desta compra.' : 'Deixe registrado e siga com o seu dia.';
    $('#expense-error').hidden = true;
    $('#save-expense').innerHTML = `${icon('check')}${expense ? 'Salvar alterações' : 'Salvar gasto'}`;
    updatePreview(); openDialog('expense-dialog'); $('#expense-name').focus();
  }
  function openBudget(month = prefs().month) {
    budgetMonth = month;
    $('#budget-month-label').textContent = capitalize(monthLabel(month));
    $('#budget-amount').value = Number.isInteger(state.budgets[month]) ? plainMoney(state.budgets[month]) : '';
    $('#budget-error').hidden = true;
    $('#remove-budget').hidden = !Number.isInteger(state.budgets[month]);
    openDialog('budget-dialog'); $('#budget-amount').focus();
  }
  function confirm(title, description, actionLabel, action, danger = true) {
    $('#confirm-title').textContent = title;
    $('#confirm-description').textContent = description;
    $('#confirm-action').textContent = actionLabel;
    $('#confirm-action').className = `button ${danger ? 'button-danger' : 'button-primary'}`;
    pendingConfirmation = action; openDialog('confirm-dialog');
  }
  function deleteExpense(id) {
    const expense = state.expenses.find((item) => item.id === id);
    if (!expense) return;
    confirm('Excluir esta compra?', `“${expense.name}”, no total de ${currency(expense.totalCents)}, será excluída${expense.installments > 1 ? ` junto com todas as suas ${expense.installments} parcelas, em todos os meses` : ''}. Esta ação não pode ser desfeita.`, 'Excluir compra', () => { state.expenses = state.expenses.filter((item) => item.id !== id); render(); persist(); toast('Compra excluída. Seu planejamento foi atualizado.'); });
  }
  function download(content, name, type) {
    const blob = new Blob([content], {type}); const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),10000);
  }
  function exportCSV() {
    const safeCell = (value) => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g,'""')}"`; };
    const rows = [['Compra','Categoria','Data','Parcela','Valor (R$)','Total da compra (R$)','Observação'], ...filteredEntries.map((entry) => [entry.name,category(entry.category).label,entry.date.split('-').reverse().join('/'),`${entry.installmentNumber}/${entry.installments}`,plainMoney(entry.amountCents),plainMoney(entry.totalCents),entry.notes])];
    download('\uFEFF'+rows.map((row) => row.map(safeCell).join(';')).join('\r\n'),`orcaviva-${prefs().month}${demoMode ? '-demo' : ''}.csv`,'text/csv;charset=utf-8');
    toast('CSV exportado com os gastos do filtro atual.');
  }
  function generateDemo() {
    const result = blankState(); const month = prefs().month; result.preferences.month = month;
    const add = (name,category,totalCents,installments,offset,day,notes = '') => {
      const monthIndex = (Number(month.slice(0,4))-1)*12+Number(month.slice(5,7))-1;
      const key = F.addMonths(month,Math.max(-monthIndex,offset));
      result.expenses.push(F.createExpense({name,category,totalCents,installments,date:`${key}-${String(day).padStart(2,'0')}`,notes}));
    };
    add('Compras da semana','mercado',32785,1,0,3,'Frutas, verduras e o básico de casa');
    add('Fone de ouvido','online',89990,6,-2,8,'Um pouco de música no dia a dia');
    add('Jantar no italiano','restaurantes',18650,1,0,6,'Sexta-feira com os amigos');
    add('Delivery de domingo','ifood',6890,1,0,7);
    add('Streaming de filmes','assinaturas',3990,1,0,5,'Plano mensal');
    add('Farmácia do bairro','farmacia',8730,1,0,10);
    add('Tênis de corrida','online',45990,3,-1,12);
    add('Cinema & pipoca','lazer',9600,1,0,13);
    add('Mercado da quinzena','mercado',24560,1,0,15);
    add('Almoço no centro','restaurantes',5490,1,0,16);
    add('Hambúrguer em casa','ifood',8290,1,0,19);
    add('Música sem anúncios','assinaturas',2190,1,0,20);
    add('Passeio de fim de semana','lazer',12500,1,0,22);
    add('Café com uma amiga','restaurantes',4250,1,0,24);
    add('Reposição da despensa','mercado',16840,1,0,26);
    add('Supermercado','mercado',78200,1,-1,6);
    add('Almoços do mês','restaurantes',42500,1,-1,10);
    add('Compras para casa','online',58900,1,-1,18);
    add('Lanches e delivery','ifood',28600,1,-1,22);
    result.budgets[month] = 250000;
    if (month !== '9999-12') result.budgets[F.addMonths(month,1)] = 200000;
    return result;
  }

  $$('[data-icon]').forEach((node) => { node.innerHTML = icon(node.dataset.icon); });
  function renderCategoryOptions(selected = $('#expense-category').value) {
    $('#expense-category').innerHTML = '<option value="">Selecione uma categoria</option>' + categories().map((item) => `<option value="${item.id}">${escape(item.label)}</option>`).join('') + '<option value="__create__">＋ Criar nova categoria</option>';
    $('#expense-category').value = category(selected) ? selected : '';
  }
  const categoryFields = document.createElement('div');
  categoryFields.id = 'new-category-fields'; categoryFields.className = 'new-category-fields'; categoryFields.hidden = true;
  categoryFields.innerHTML = '<label class="form-field">Nome da nova categoria<input id="new-category-name" placeholder="Ex.: Transporte, Pets, Educação..." maxlength="40" autocomplete="off"></label><div class="new-category-actions"><button type="button" class="button button-primary" id="create-category">Criar categoria</button><button type="button" class="button button-outline" id="cancel-category">Cancelar</button></div><p id="category-error" class="form-error" role="alert" hidden></p>';
  $('#expense-category').closest('.form-row').after(categoryFields);
  $('#expense-category').addEventListener('change',() => {
    if ($('#expense-category').value === '__create__') {
      $('#expense-category').value = previousCategory;
      categoryFields.hidden = false; $('#category-error').hidden = true; $('#new-category-name').focus();
    } else { previousCategory = $('#expense-category').value; categoryFields.hidden = true; }
    if (!$('#expense-id').value) { prefs().draft = captureDraft(); persist(); }
  });
  $('#create-category').onclick = () => {
    if (staleDialog()) return;
    try {
      const created = F.createCategory($('#new-category-name').value,state.customCategories);
      validateState({...state,customCategories:[...state.customCategories,created]});
      state.customCategories.push(created);
      categoryFields.hidden = true; $('#new-category-name').value = '';
      renderCategoryOptions(created.id); previousCategory = created.id;
      if (!$('#expense-id').value) prefs().draft = captureDraft();
      render(); persist(); $('#expense-category').focus();
      toast(`Categoria “${created.label}” criada.`);
    } catch (error) { $('#category-error').textContent = error.message; $('#category-error').hidden = false; }
  };
  $('#cancel-category').onclick = () => { categoryFields.hidden = true; $('#new-category-name').value = ''; $('#expense-category').focus(); };
  $('#new-category-name').addEventListener('keydown',(event) => { if (event.key === 'Enter') { event.preventDefault(); $('#create-category').click(); } });
  $$('[data-view]').forEach((button) => button.addEventListener('click',() => mutatePreferences({view:button.dataset.view})));
  $('.brand').addEventListener('click',(event) => { event.preventDefault(); mutatePreferences({view:'overview'}); });
  $('#add-expense').onclick = () => openExpense();
  $('#empty-add').onclick = () => $('#empty-add').dataset.clear === 'true' ? mutatePreferences({category:'all',search:'',page:1}) : openExpense();
  $('#set-budget').onclick = () => openBudget();
  $('#previous-year').onclick = () => selectMonth(F.addMonths(prefs().month,-12));
  $('#next-year').onclick = () => selectMonth(F.addMonths(prefs().month,12));
  $('#current-month').onclick = () => selectMonth(F.todayISO().slice(0,7));
  $('#month-tabs').addEventListener('click',(event) => { const button = event.target.closest('[data-month]'); if (button) selectMonth(button.dataset.month); });
  $('#month-tabs').addEventListener('keydown',(event) => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const index = Number(prefs().month.slice(5,7))-1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 11 : (index+(event.key === 'ArrowRight' ? 1 : -1)+12)%12;
    selectMonth(`${prefs().month.slice(0,4)}-${String(next+1).padStart(2,'0')}`);
    $('#month-tabs .active').focus({preventScroll:true});
  });
  $('#search-expenses').addEventListener('input',(event) => mutatePreferences({search:event.target.value.slice(0,100),page:1}));
  $('#category-filters').addEventListener('click',(event) => { const button = event.target.closest('[data-category]'); if (button) { mutatePreferences({category:button.dataset.category,page:1}); $(`#category-filters [data-category="${button.dataset.category}"]`).focus({preventScroll:true}); } });
  $('#category-legend').addEventListener('click',(event) => { const button = event.target.closest('[data-category]'); if (button) { mutatePreferences({category:button.dataset.category,search:'',page:1}); $('#transactions-panel').scrollIntoView({behavior:'smooth',block:'start'}); } });
  $('#clear-filters').onclick = () => mutatePreferences({category:'all',search:'',page:1});
  $$('[data-sort]').forEach((button) => button.addEventListener('click',() => mutatePreferences({sort:button.dataset.sort,direction:prefs().sort === button.dataset.sort && prefs().direction === 'desc' ? 'asc' : 'desc',page:1})));
  $('#pagination').addEventListener('click',(event) => { const button = event.target.closest('[data-page]'); if (button && !button.disabled) mutatePreferences({page:Number(button.dataset.page)}); });
  document.addEventListener('click',(event) => {
    const edit = event.target.closest('[data-edit]'), remove = event.target.closest('[data-delete]'), close = event.target.closest('[data-close]');
    if (edit) openExpense(edit.dataset.edit);
    if (remove) deleteExpense(remove.dataset.delete);
    if (close) $(`#${close.dataset.close}`).close();
    const month = event.target.closest('[data-plan-month]'), budget = event.target.closest('[data-budget-month]');
    if (month) mutatePreferences({month:month.dataset.planMonth,view:'overview',page:1});
    if (budget) openBudget(budget.dataset.budgetMonth);
  });
  $$('dialog:not(#tour-dialog)').forEach((dialog) => dialog.addEventListener('click',(event) => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close(); }));
  $('#confirm-dialog').addEventListener('close',() => { pendingConfirmation = null; });
  function staleDialog() {
    if (!pendingExternalState && !accountStore?.conflict) return false;
    toast('Sua conta mudou em outro dispositivo. Feche o formulário e carregue a versão do servidor pelo aviso no painel.',true);
    return true;
  }
  $('#confirm-action').onclick = () => { if (staleDialog()) return; const action = pendingConfirmation; $('#confirm-dialog').close(); action?.(); };
  $('#expense-form').addEventListener('input',() => { updatePreview(); $('#expense-error').hidden = true; if (!$('#expense-id').value && !pendingExternalState) { prefs().draft = captureDraft(); persist(); } });
  $('#expense-form').addEventListener('change',updatePreview);
  $('#expense-form').addEventListener('submit',(event) => {
    event.preventDefault();
    if (staleDialog()) return;
    try {
      const id = $('#expense-id').value;
      const existing = id ? state.expenses.find((item) => item.id === id) : null;
      const expense = F.createExpense({name:$('#expense-name').value,category:$('#expense-category').value,totalCents:F.toCents($('#expense-amount').value),installments:$('#expense-is-installment').checked ? Number($('#expense-installments').value) : 1,date:$('#expense-date').value,notes:$('#expense-notes').value},id || undefined,state.customCategories);
      if (id && !existing) throw new Error('Esta compra não existe mais. Feche o formulário e tente novamente.');
      if (existing) { expense.createdAt = existing.createdAt; if (existing.paymentMethod) expense.paymentMethod = existing.paymentMethod; }
      const candidateExpenses = existing ? state.expenses.map((item) => item.id === id ? expense : item) : [...state.expenses,expense];
      validateState({...state,expenses:candidateExpenses});
      state.expenses = candidateExpenses;
      if (!existing) delete prefs().draft;
      Object.assign(prefs(),{month:expense.date.slice(0,7),category:'all',search:'',page:1});
      $('#expense-dialog').close(); render(); persist();
      toast(existing ? 'Compra atualizada em todos os meses.' : expense.installments > 1 ? `Compra salva! ${expense.installments} parcelas distribuídas entre os meses.` : 'Gasto adicionado. Tudo no seu lugar!');
    } catch (error) { $('#expense-error').textContent = error.message || 'Confira os dados e tente novamente.'; $('#expense-error').hidden = false; }
  });
  $('#budget-form').addEventListener('submit',(event) => {
    event.preventDefault();
    if (staleDialog()) return;
    try { const value = F.toCents($('#budget-amount').value); if (!Number.isSafeInteger(value) || value < 0) throw new Error('Informe um valor válido para o orçamento.'); state.budgets[budgetMonth] = value; $('#budget-dialog').close(); render(); persist(); toast('Orçamento salvo. Você já tem um plano!'); }
    catch (error) { $('#budget-error').textContent = error.message; $('#budget-error').hidden = false; }
  });
  $('#remove-budget').onclick = () => { if (staleDialog()) return; delete state.budgets[budgetMonth]; $('#budget-dialog').close(); render(); persist(); toast('Limite removido para este mês.'); };
  $('#export-csv').onclick = exportCSV;
  $('#export-backup').onclick = () => { download(JSON.stringify(state,null,2),`orcaviva-backup-${F.todayISO()}${demoMode ? '-demo' : ''}.json`,'application/json'); toast('Backup exportado. Guarde o arquivo em um lugar seguro.'); };
  $('#import-backup').onclick = () => { $('#import-file').value = ''; $('#import-file').click(); };
  $('#import-file').addEventListener('change',async (event) => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('O arquivo é muito grande. O limite é 8 MB.');
      const imported = normalizePreferences(validateState(JSON.parse(await file.text())));
      confirm('Importar este backup?', `O arquivo contém ${imported.expenses.length} compra(s) e ${Object.keys(imported.budgets).length} orçamento(s). Ele substituirá os dados ${demoMode ? 'da demonstração' : 'atuais deste navegador'}. Exporte um backup dos dados atuais se quiser preservá-los.`, 'Substituir e importar', () => { state = imported; recoveryRaw = null; render(); persist(); toast('Backup importado. Seus dados estão prontos.'); });
    } catch (error) { toast(error instanceof SyntaxError ? 'Este arquivo não contém um JSON válido.' : error.message || 'Não foi possível importar este arquivo.',true); }
  });
  $('#start-demo').onclick = async () => {
    try {
      await accountStore.flush();
      if (prefs().month > '9999-07') prefs().month = '9999-07';
      const sample = generateDemo(); demoMode = true; window.OrcavivaChat.reset(); state = sample; recoveryRaw = null; storageError = ''; render(); persist(); toast('Demonstração ativada. Explore todos os recursos!');
    } catch (error) { toast(error.message,true); }
  };
  $('#exit-demo').onclick = () => {
    demoMode = false; recoveryRaw = null; storageError = '';
    state = normalizePreferences(accountStore.data ? F.validateBackup(accountStore.data) : blankState());
    try { localStorage.setItem(MODE_KEY,'false'); } catch { /* A conta continua no servidor. */ }
    render(); refreshAccount(); openChat(); toast('Seu espaço pessoal está pronto.');
  };

  function authMessage(message, error = false) {
    $('#auth-message').textContent = message;
    $('#auth-message').hidden = !message;
    $('#auth-message').classList.toggle('is-error',error);
    $('#auth-message').setAttribute('role',error ? 'alert' : 'status');
  }
  function authMode(mode) {
    mode = mode === true ? 'register' : mode === false ? 'login' : mode;
    if (mode !== 'reset') resetToken = '';
    for (const kind of ['login','register','forgot','reset']) $(`#${kind}-form`).hidden = mode !== kind;
    $('.auth-tabs').hidden = ['forgot','reset'].includes(mode);
    $('#show-forgot').hidden = mode !== 'login';
    $('#back-login').hidden = !['forgot','reset'].includes(mode);
    $('#show-login').classList.toggle('active',mode === 'login');
    $('#show-register').classList.toggle('active',mode === 'register');
    $('#show-login').setAttribute('aria-pressed',String(mode === 'login'));
    $('#show-register').setAttribute('aria-pressed',String(mode === 'register'));
    const copy = {
      login: ['Bom te ver por aqui.', 'Entre na sua conta e retome seus planos.'],
      register: ['Um novo começo.', 'Crie sua conta e comece a organizar seus planos.'],
      forgot: ['Vamos recuperar seu acesso.', 'Informe o e-mail cadastrado. Enviaremos um link para você criar uma nova senha.'],
      reset: ['Uma nova senha, um novo começo.', 'Escolha uma senha para voltar aos seus planos.']
    };
    $('#auth-title').textContent = copy[mode][0];
    $('#auth-description').textContent = copy[mode][1];
    authMessage('');
  }
  function setAuthBusy(busy) {
    authBusy = busy;
    $$('#auth-screen button').forEach((button) => { button.disabled = busy; });
    $('#login-submit').textContent = busy ? 'Aguarde…' : 'Entrar na minha conta →';
    $('#register-submit').textContent = busy ? 'Aguarde…' : 'Criar minha conta →';
    $('#forgot-submit').textContent = busy ? 'Aguarde…' : 'Enviar link de recuperação →';
    $('#reset-submit').textContent = busy ? 'Aguarde…' : 'Salvar nova senha →';
  }
  function lockAccount(message = '') {
    window.OrcavivaChat.reset();
    authGeneration++;
    clearInterval(syncInterval);
    accountStore?.close(); accountStore = null;
    currentUser = null; demoMode = false; pendingExternalState = null;
    $$('dialog[open]').forEach((dialog) => dialog.close());
    $('#app-shell').hidden = true; $('#app-shell').inert = true;
    $('#auth-screen').hidden = false;
    state = blankState(); allEntries = []; monthEntries = []; filteredEntries = [];
    for (const id of ['expense-rows','category-legend','trend-chart','planning-grid','commitments-list']) $(`#${id}`).replaceChildren();
    $('#expense-form').reset(); $('#budget-form').reset();
    $('#login-password').value = ''; $('#register-form').reset();
    $('#reset-form').reset(); $('#account-email-form').reset();
    $$('[data-password]').forEach((button) => { $(`#${button.dataset.password}`).type = 'password'; button.textContent = 'Mostrar'; button.setAttribute('aria-label','Mostrar senha'); button.setAttribute('aria-pressed','false'); });
    $('#toast-region').replaceChildren();
    authMode(false); authMessage(message,Boolean(message));
    $('#login-username').focus();
  }
  async function enterAccount(session) {
    window.OrcavivaChat.reset();
    const generation = ++authGeneration;
    accountStore?.close(); clearInterval(syncInterval);
    currentUser = session.user;
    demoMode = false; pendingExternalState = null; storageError = ''; recoveryRaw = null;
    const store = new API.AccountStore(currentUser.id,{
      onStatus:() => showStorageStatus(),
      onRemote:(data) => { if (!demoMode) { state = normalizePreferences(data || blankState()); render(); } },
      onConflict:(remote) => { pendingExternalState = remote.data || blankState(); },
      onExpired:() => lockAccount('Sua sessão expirou ou mudou em outra aba. Entre novamente. Suas alterações pendentes foram preservadas neste dispositivo.'),
      isEditing:() => Boolean($('dialog[open]:not(#chat-dialog)')),
    });
    accountStore = store;
    MAIN_KEY = store.key;
    DEMO_KEY = `finanto.account.${currentUser.id}.demo.v1`;
    MODE_KEY = `finanto.account.${currentUser.id}.demo.active`;
    try {
      const data = await store.load();
      if (generation !== authGeneration) return;
      state = normalizePreferences(data || blankState());
      $('#account-name').textContent = currentUser.name;
      $('#account-username').textContent = `@${currentUser.username}`;
      $('#login-password').value = ''; $('#register-form').reset();
      $('#migration-notice').hidden = !legacyDataExists();
      $('#email-reminder').hidden = Boolean(currentUser.email);
      render();
      $('#auth-screen').hidden = true;
      $('#app-shell').hidden = false; $('#app-shell').inert = false;
      $('#main-content').setAttribute('tabindex','-1'); $('#main-content').focus({preventScroll:true});
      syncInterval = setInterval(refreshAccount,15000);
      openChat();
      if (!currentUser.tourCompleted) window.OrcavivaTour.start(currentUser);
    } catch (error) {
      store.close(); currentUser = null; accountStore = null;
      throw error;
    }
  }
  async function refreshAccount() {
    const store = accountStore;
    if (!currentUser || !store || demoMode || document.hidden) return;
    try { await store.refresh(); }
    catch (error) {
      if (store !== accountStore) return;
      if (error.status === 401) lockAccount('Entre novamente para continuar na sua conta.');
      else if (error.status !== 409) store.emit('error',store.dirty ? `${error.message} Há alterações pendentes neste dispositivo.` : `${error.message} A atualização entre dispositivos será retomada quando a conexão voltar.`);
    }
  }
  function resolveSyncConflict() {
    confirm('Carregar a versão do servidor?', 'As alterações pendentes neste dispositivo serão substituídas. Baixe uma cópia pelo aviso do painel se quiser guardá-las.', 'Carregar versão atual', async () => {
      try {
        const data = await accountStore.useRemote();
        pendingExternalState = null;
        state = normalizePreferences(data || blankState());
        render(); toast('Sua conta está atualizada. Você pode continuar.');
      } catch (error) { if (error.status === 401) lockAccount('Entre novamente para carregar a versão atual da sua conta.'); else toast(error.message,true); }
    },false);
    // Esta confirmação resolve o conflito, portanto precisa poder executá-la.
    $('#confirm-action').onclick = () => { const action = pendingConfirmation; $('#confirm-dialog').close(); action?.(); resetConfirmAction(); };
  }
  function resetConfirmAction() { $('#confirm-action').onclick = () => { if (staleDialog()) return; const action = pendingConfirmation; $('#confirm-dialog').close(); action?.(); }; }
  $('#confirm-dialog').addEventListener('close',resetConfirmAction);
  function legacyDataExists() {
    try { const raw = localStorage.getItem(LEGACY_KEY); if (!raw) return false; const data = F.validateBackup(JSON.parse(raw)); return data.expenses.length > 0 || Object.keys(data.budgets).length > 0 || data.customCategories.length > 0; }
    catch { return false; }
  }
  $('#legacy-export').onclick = () => {
    try { const raw = localStorage.getItem(LEGACY_KEY); if (!raw) return; download(raw,`orcaviva-backup-anterior-${F.todayISO()}.json`,'application/json'); }
    catch { authMessage('Não foi possível ler os dados anteriores deste navegador.',true); }
  };
  $('#migrate-local').onclick = () => {
    try {
      const previous = normalizePreferences(validateState(JSON.parse(localStorage.getItem(LEGACY_KEY))));
      confirm('Importar seus gastos anteriores?', `Encontramos ${previous.expenses.length} compra(s). Estes dados substituirão o conteúdo atual desta conta; o arquivo antigo continuará preservado no navegador.`, 'Importar para minha conta',() => {
        state = previous; $('#migration-notice').hidden = true; render(); persist(); toast('Dados anteriores importados para sua conta.');
      });
    } catch (error) { toast(error.message,true); }
  };
  $('#show-login').onclick = () => authMode(false);
  $('#show-register').onclick = () => authMode(true);
  $('#show-forgot').onclick = () => { authMode('forgot'); $('#forgot-email').focus(); };
  $('#back-login').onclick = () => { authMode(false); $('#reset-form').reset(); $('#login-username').focus(); };
  $('#reset-resend').onclick = () => { authMode('forgot'); $('#reset-form').reset(); $('#forgot-email').focus(); };
  function validNewPassword(input) {
    const valid = input.value.length >= 8 && input.value.length <= 128 && /[\p{P}\p{S}]/u.test(input.value);
    input.setCustomValidity(valid ? '' : 'Use pelo menos 8 caracteres e 1 especial, como !, @ ou #.');
    return valid;
  }
  for (const id of ['register-password','reset-password']) {
    $(`#${id}`).addEventListener('input',event => validNewPassword(event.target));
    $(`#${id}`).form.addEventListener('reset',() => $(`#${id}`).setCustomValidity(''));
  }
  $('#forgot-form').addEventListener('submit',async event => {
    event.preventDefault(); if (authBusy) return;
    setAuthBusy(true); authMessage('');
    try {
      const result = await API.request('forgot-password',{method:'POST',body:{email:$('#forgot-email').value.trim()}});
      authMessage(result.message);
    } catch (error) { authMessage(error.message,true); }
    finally { setAuthBusy(false); }
  });
  $('#reset-form').addEventListener('submit',async event => {
    event.preventDefault(); if (authBusy) return;
    if (!validNewPassword($('#reset-password'))) { $('#reset-password').reportValidity(); return; }
    if ($('#reset-password').value !== $('#reset-confirm').value) { authMessage('As senhas não coincidem. Confira os dois campos.',true); return; }
    setAuthBusy(true); authMessage('');
    try {
      const result = await API.request('reset-password',{method:'POST',body:{token:resetToken,password:$('#reset-password').value}});
      $('#reset-form').reset(); resetToken = '';
      lockAccount(); authMessage(result.message);
    } catch (error) { authMessage(error.message,true); }
    finally { setAuthBusy(false); }
  });
  $('#replay-tour').onclick = () => { if (currentUser) window.OrcavivaTour.start(currentUser); };
  function openChat(focus = false) {
    if (!currentUser) return;
    if (demoMode) { toast('Saia da demonstração para conversar sobre sua conta real.'); return; }
    const store = accountStore, user = currentUser;
    window.OrcavivaChat.open({userId:user.id,
      prepare:async () => {
        if (demoMode || currentUser !== user || store.closed) throw new Error('Volte à sua conta para usar o chat.');
        await store.flush(); await store.refresh();
        if (demoMode || currentUser !== user || store.closed) throw new Error('Entre novamente na sua conta.');
        if (store.conflict) throw new Error('Resolva as alterações pendentes no painel antes de usar o chat.');
        return store.revision;
      },
      updated:async () => { if (currentUser === user && !demoMode && !store.closed) await store.refresh(); }
    },focus);
  }
  $('#open-chat').onclick = () => openChat(true);
  $('#add-account-email').onclick = () => { $('#account-email-form').reset(); $('#account-email-error').hidden = true; openDialog('account-email-dialog'); };
  $('#account-email-dialog').addEventListener('close',() => $('#account-email-form').reset());
  $('#account-email-form').addEventListener('submit',async event => {
    event.preventDefault(); if (!currentUser || $('#account-email-submit').disabled) return;
    const user = currentUser;
    $('#account-email-submit').disabled = true; $('#account-email-error').hidden = true;
    try {
      const result = await API.request('account/email',{method:'POST',accountId:user.id,body:{email:$('#account-email').value.trim(),password:$('#account-email-password').value}});
      if (currentUser !== user) return;
      currentUser.email = result.user.email;
      $('#email-reminder').hidden = true; $('#account-email-dialog').close(); toast('E-mail de recuperação cadastrado.');
    } catch (error) {
      if (currentUser !== user) return;
      $('#account-email-error').textContent = error.message; $('#account-email-error').hidden = false;
    } finally { $('#account-email-submit').disabled = false; }
  });
  $$('[data-password]').forEach((button) => button.addEventListener('click',() => {
    const input = $(`#${button.dataset.password}`);
    const show = input.type === 'password'; input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Ocultar' : 'Mostrar';
    button.setAttribute('aria-label',show ? 'Ocultar senha' : 'Mostrar senha');
    button.setAttribute('aria-pressed',String(show));
  }));
  $('#login-form').addEventListener('submit',async (event) => {
    event.preventDefault(); if (authBusy) return;
    setAuthBusy(true); authMessage('');
    const generation = authGeneration;
    try {
      const session = await API.request('login',{method:'POST',body:{username:$('#login-username').value.trim(),password:$('#login-password').value}});
      if (generation !== authGeneration) return;
      await enterAccount(session);
    } catch (error) { authMessage(error.message,true); }
    finally { setAuthBusy(false); }
  });
  $('#register-form').addEventListener('submit',async (event) => {
    event.preventDefault(); if (authBusy) return;
    if (!validNewPassword($('#register-password'))) { $('#register-password').reportValidity(); return; }
    if ($('#register-password').value !== $('#register-confirm').value) { authMessage('As senhas não coincidem. Confira os dois campos.',true); $('#register-confirm').focus(); return; }
    setAuthBusy(true); authMessage('');
    const generation = authGeneration;
    try {
      const session = await API.request('register',{method:'POST',body:{name:$('#register-name').value.trim(),email:$('#register-email').value.trim(),username:$('#register-username').value.trim(),password:$('#register-password').value}});
      if (generation !== authGeneration) return;
      await enterAccount(session);
    } catch (error) { authMessage(error.message,true); }
    finally { setAuthBusy(false); }
  });
  $('#logout').onclick = async () => {
    if (!currentUser) return;
    const store = accountStore, user = currentUser;
    $('#logout').disabled = true;
    $('#app-shell').inert = true;
    try {
      if (!store.conflict) await store.flush();
      await API.request('logout',{method:'POST',body:{},accountId:user.id});
      const hasPending = store.dirty;
      store.close(!hasPending);
      try { localStorage.removeItem(DEMO_KEY); localStorage.removeItem(MODE_KEY); } catch { /* Dados reais já estão no servidor. */ }
      lockAccount(); authMessage(hasPending ? 'Você saiu. As alterações pendentes foram preservadas neste dispositivo para o próximo acesso.' : 'Você saiu da sua conta. Até a próxima!');
    } catch (error) {
      if (error.status === 401) lockAccount('A sessão já foi encerrada. Entre novamente para continuar.');
      else toast(`Não foi possível sair: ${error.message}`,true);
    } finally { $('#logout').disabled = false; if (currentUser) $('#app-shell').inert = false; }
  };
  window.addEventListener('focus',refreshAccount);
  document.addEventListener('visibilitychange',() => { if (!document.hidden) refreshAccount(); });
  window.addEventListener('online',refreshAccount);
  window.addEventListener('beforeunload',(event) => { if (accountStore?.dirty && !accountStore.closed) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('storage',(event) => { if (event.key === MAIN_KEY && currentUser && !demoMode) refreshAccount(); });

  function openResetLink() {
    if (!location.hash.startsWith('#reset=')) return false;
    const token = location.hash.slice(7);
    history.replaceState(null,'',location.pathname + location.search);
    lockAccount();
    resetToken = token;
    authMode('reset');
    if (!/^[A-Za-z0-9_-]{43}$/.test(resetToken)) authMessage('Este link é inválido. Solicite um novo e-mail.',true);
    $('#reset-password').focus();
    return true;
  }
  window.addEventListener('hashchange',() => { openResetLink(); });
  async function start() {
    $('#legacy-help').hidden = !legacyDataExists();
    if (!['http:','https:'].includes(location.protocol)) {
      $('#auth-server-help').hidden = false;
      $('#login-form').hidden = true; $('#register-form').hidden = true; $('.auth-tabs').hidden = true;
      $('#show-forgot').hidden = true;
      $('#auth-title').textContent = 'Seu próximo passo está pronto.';
      $('#auth-description').textContent = 'Acesse pelo servidor para entrar na sua conta.';
      return;
    }
    if (openResetLink()) return;
    setAuthBusy(true); authMessage('Verificando sua sessão…');
    const generation = authGeneration;
    try { const session = await API.request('session'); if (generation !== authGeneration) return; if (session.user) await enterAccount(session); else authMessage(''); }
    catch (error) { authMessage(error.message,true); }
    finally { setAuthBusy(false); }
  }
  start();
})();
