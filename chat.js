(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const dialog = $('#chat-dialog');
  let context = null, busy = false, chatRevision = 0, pending = null;
  const escape = text => String(text).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function download(content,type,name) {
    const url = URL.createObjectURL(new Blob([content],{type}));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  function reportCard(report, text) {
    const card = document.createElement('div'); card.className = 'chat-report';
    for (const category of report.categories) {
      const row = document.createElement('div'); row.className = 'chat-report-row';
      const name = document.createElement('span'); name.textContent = category.label;
      const value = document.createElement('strong'); value.textContent = Finance.formatCurrency(category.totalCents);
      const meter = document.createElement('div'); meter.className = 'chat-report-meter';
      const bar = document.createElement('i'); bar.style.width = (category.totalCents/report.totalCents*100)+'%'; bar.style.backgroundColor = category.color;
      meter.append(bar); row.append(name,value,meter); card.append(row);
    }
    const exportText = document.createElement('button'); exportText.className = 'text-button'; exportText.textContent = 'Baixar relatório';
    exportText.onclick = () => download(text,'text/plain;charset=utf-8',`orcaviva-relatorio-${report.month}.txt`);
    const exportChart = document.createElement('button'); exportChart.className = 'text-button'; exportChart.textContent = 'Baixar gráfico';
    exportChart.onclick = () => {
      const rows = report.categories.map((c,i) => `<text x="24" y="${110+i*55}" font-size="13">${escape(c.label)}</text><text x="616" y="${110+i*55}" text-anchor="end" font-size="13">${escape(Finance.formatCurrency(c.totalCents))}</text><rect x="24" y="${120+i*55}" width="${Math.round(c.totalCents/report.totalCents*592)}" height="9" rx="4" fill="${escape(c.color)}"/>`).join('');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${Math.max(180,150+55*report.categories.length)}"><rect width="100%" height="100%" fill="#f8faf6"/><g font-family="Arial,sans-serif" fill="#263e33"><text x="24" y="34" font-size="22">Orçaviva · ${escape(report.month)}</text><text x="24" y="65" font-size="14">${escape(report.label)} · ${escape(Finance.formatCurrency(report.totalCents))}</text>${rows}</g></svg>`;
      download(svg,'image/svg+xml',`orcaviva-grafico-${report.month}.svg`);
    };
    card.append(exportText,exportChart); return card;
  }
  function render(payload) {
    chatRevision = payload.chatRevision;
    const history = $('#chat-history'); history.replaceChildren();
    const messages = payload.history.length ? payload.history : [{role:'assistant',text:'Oi! Vamos organizar uma compra?\nEscreva “Gastei 85,90 no mercado via Pix” ou peça um relatório do mês. Se faltar um detalhe, eu pergunto antes de salvar.'}];
    for (const item of messages) {
      const message = document.createElement('article'); message.className = 'chat-message '+item.role;
      const author = document.createElement('small'); author.textContent = item.role === 'user' ? 'Você' : 'Orçaviva';
      const text = document.createElement('p'); text.textContent = item.text;
      message.append(author,text); if (item.report) message.append(reportCard(item.report,item.text)); history.append(message);
    }
    const suggestions = $('#chat-suggestions'); suggestions.replaceChildren();
    for (const value of messages.at(-1).actions?.length ? messages.at(-1).actions : ['Ajuda','Relatório deste mês','Cancelar']) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = value;
      button.onclick = () => { $('#chat-input').value = value; $('#chat-input').focus(); };
      suggestions.append(button);
    }
    history.scrollTop = history.scrollHeight;
  }
  function setBusy(value) {
    busy = value;
    $('#chat-send').disabled = value; $('#chat-input').disabled = value; $('#chat-refresh').disabled = value;
    $('#chat-send').textContent = value ? 'Enviando…' : 'Enviar →';
    $('#chat-status').textContent = value ? 'Processando sua mensagem…' : 'No crédito, a primeira fatura vai para o próximo mês.';
  }
  function error(message) { $('#chat-error').textContent = message; $('#chat-error').hidden = !message; }
  function savePending() {
    try { if (pending) sessionStorage.setItem('orcaviva.chat.pending.'+context.userId,JSON.stringify(pending)); else sessionStorage.removeItem('orcaviva.chat.pending.'+context.userId); } catch { /* In-memory retries still use the same identifier. */ }
  }
  async function refresh() {
    if (!context || busy) return;
    const owner = context; setBusy(true); error('');
    try { await owner.prepare(); if (owner !== context) return; const payload = await FinantoAPI.request('chat',{accountId:owner.userId}); if (owner === context) render(payload); }
    catch (e) { if (owner === context) error(e.message); }
    finally { if (owner === context) setBusy(false); }
  }
  $('#chat-refresh').onclick = refresh;
  function expand(focus = false) {
    if (!context) return;
    dialog.hidden = false;
    $('#restore-chat').hidden = true;
    $('#restore-chat').setAttribute('aria-expanded','true');
    if (focus && !busy) $('#chat-input').focus();
    $('#chat-history').scrollTop = $('#chat-history').scrollHeight;
  }
  function minimize() {
    dialog.hidden = true;
    $('#restore-chat').hidden = false;
    $('#restore-chat').setAttribute('aria-expanded','false');
    $('#restore-chat').focus({preventScroll:true});
  }
  $('#close-chat').onclick = minimize;
  $('#restore-chat').onclick = () => expand(true);
  dialog.addEventListener('keydown',event => { if (event.key === 'Escape') { event.preventDefault(); minimize(); } });
  $('#chat-form').addEventListener('submit',async event => {
    event.preventDefault(); if (busy || !context || !$('#chat-input').value.trim()) return;
    const owner = context, text = $('#chat-input').value.trim();
    setBusy(true); error('');
    try {
      const revision = await owner.prepare();
      if (owner !== context) return;
      if (!pending || pending.text !== text) {
        pending = {messageId:Array.from(crypto.getRandomValues(new Uint8Array(16)),b => b.toString(16).padStart(2,'0')).join(''),text,revision,chatRevision}; savePending();
      }
      const payload = await FinantoAPI.request('chat',{method:'POST',body:pending,accountId:owner.userId});
      if (owner !== context) return;
      pending = null; savePending(); $('#chat-input').value = ''; render(payload);
      await owner.updated();
    } catch (e) {
      if (owner !== context) return;
      if (e.status === 409) { pending = null; savePending(); }
      error(e.message + (e.status === 409 ? ' Clique em Atualizar conversa.' : ' Você pode tentar enviar novamente.'));
    } finally { if (owner === context) { setBusy(false); if (!dialog.hidden && document.activeElement === $('#chat-send')) $('#chat-input').focus(); } }
  });
  window.OrcavivaChat = Object.freeze({
    reset() {
      context = null; pending = null; chatRevision = 0;
      dialog.hidden = true; $('#restore-chat').hidden = true;
      $('#restore-chat').setAttribute('aria-expanded','false');
      $('#chat-history').replaceChildren(); $('#chat-suggestions').replaceChildren(); $('#chat-input').value = '';
      setBusy(false); error('');
    },
    async open(options, focus = false) {
      if (context?.userId === options.userId) { expand(focus); return; }
      context = options;
      try { pending = JSON.parse(sessionStorage.getItem('orcaviva.chat.pending.'+options.userId) || 'null'); } catch { pending = null; }
      $('#chat-input').value = pending?.text || '';
      expand(); await refresh(); if (context === options && focus && !dialog.hidden) $('#chat-input').focus();
    }
  });
})();
