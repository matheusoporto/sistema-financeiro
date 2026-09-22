'use strict';
const F = require('./finance.js');
const key = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const money = '(?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,\\d{1,2}|\\.\\d{1,2})?';
const months = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const payments = { pix:'Pix', credito:'Crédito', debito:'Débito', dinheiro:'Dinheiro', boleto:'Boleto' };
const blank = () => ({ version:1, expenses:[], customCategories:[], budgets:{}, preferences:{} });
const help = 'Posso registrar uma compra por mensagem, corrigir o último lançamento e consultar seus gastos. Exemplos:\n• Gastei 85,90 no mercado via Pix\n• Comprei um tênis por 300 em 3 vezes, categoria Online\n• Relatório de setembro de 2026\n• Quanto gastei com mercado este mês?\n• Corrigir último gasto: valor 90\n• Desfazer último gasto\n\nInforme valores em números. No crédito, a primeira fatura vai para o mês seguinte à compra, mesmo em uma vez. Uma data explícita de primeira parcela ou fatura tem prioridade. Nos outros pagamentos, sem data uso hoje. Esta versão interpreta texto por regras, ainda sem IA externa ou WhatsApp.';

function categoryFor(text, custom) {
  const normalized = key(text);
  const categories = F.getCategories(custom);
  const exact = categories.find(c => key(c.label) === normalized);
  if (exact) return exact.id;
  const matches = categories.filter(c => normalized.includes(key(c.label)));
  const aliases = { mercado:/\b(supermercado|hortifruti)\b/, restaurantes:/\b(restaurante|almoco|jantar|lanchonete)\b/, farmacia:/\b(remedio|drogaria)\b/, assinaturas:/\b(netflix|spotify|assinatura)\b/, lazer:/\b(cinema|teatro)\b/ };
  for (const [id, pattern] of Object.entries(aliases)) if (pattern.test(normalized) && !matches.some(c => c.id === id)) matches.push(categories.find(c => c.id === id));
  return matches.length === 1 ? matches[0].id : null;
}

function dateFrom(text, today, report = false) {
  const value = key(text);
  if (months.filter(m => new RegExp(`\\b${m}\\b`).test(value)).length > 1) throw new Error('Informe somente um mês por mensagem.');
  if (report && /\b\d{4}-\d{2}\b/.test(value)) { const month = value.match(/\b\d{4}-\d{2}\b/)[0]; F.addMonths(month,0); return month+'-01'; }
  const iso = value.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (iso) { F.monthKey(iso[0]); return iso[0]; }
  const date = value.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (date) {
    const result = `${date[3] || today.slice(0,4)}-${date[2].padStart(2,'0')}-${date[1].padStart(2,'0')}`;
    F.monthKey(result); return result;
  }
  if (/\bontem\b/.test(value)) return new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
  if (report && /mes passado|mes anterior/.test(value)) return F.addMonths(today.slice(0,7),-1)+'-01';
  const month = months.findIndex(m => new RegExp(`\\b${m}\\b`).test(value));
  if (month >= 0) return `${value.match(/\b(20\d{2})\b/)?.[1] || today.slice(0,4)}-${String(month+1).padStart(2,'0')}-01`;
  if (report || /\bhoje\b/.test(value)) return today;
  return null;
}

function nextBillingDate(date) {
  const month = F.addMonths(F.monthKey(date),1);
  const [year,number] = month.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastDay = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31][number-1];
  return `${month}-${String(Math.min(Number(date.slice(8)),lastDay)).padStart(2,'0')}`;
}

function parseExpense(text, custom, today) {
  const normalized = key(text);
  if (/us\$|usd|eur|€|dolares|dolar|euros|amanha|proximo mes/.test(normalized)) throw new Error('Por enquanto, use valores em reais e uma data explícita, como 20/09/2026.');
  if (/\b(nao|talvez|pretendo|quero|vou|recebi|ganhei)\b/.test(normalized)) throw new Error('Registre somente compras já feitas. Exemplo: “Gastei 85,90 no mercado via Pix”.');
  const draft = { date:dateFrom(text,today) || today, installments:1 };
  let cleaned = text;
  for (const method of Object.keys(payments)) if (new RegExp(`\\b${method}\\b`).test(normalized)) draft.paymentMethod = method;
  if (Object.keys(payments).filter(method => new RegExp(`\\b${method}\\b`).test(normalized)).length > 1) throw new Error('Informe uma única forma de pagamento por compra.');
  const firstBill = normalized.match(/\b(?:primeira (?:parcela|fatura)|vencimento)\b(.*)$/);
  if (draft.paymentMethod === 'credito') {
    const explicitDate = firstBill && dateFrom(firstBill[1],today);
    if (firstBill && !explicitDate) throw new Error('Informe a data da primeira fatura, como “primeira fatura em 20/10/2026”.');
    draft.date = explicitDate || nextBillingDate(draft.date);
  }
  const per = normalized.match(new RegExp(`(\\d+)\\s*(?:x|vezes|parcelas)\\s+de\\s*(?:r\\$\\s*)?(${money})`, 'i'));
  const installments = normalized.match(/\b(\d+)\s*(?:x|vezes|parcelas)\b/);
  if (installments) draft.installments = Number(installments[1]);
  else if (/\b(parcelad[oa]|vezes|parcelas)\b/.test(normalized)) draft.installments = null;
  if (per) draft.totalCents = F.toCents(per[2]) * Number(per[1]);
  cleaned = cleaned.replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{4})?\b/g,' ')
    .replace(/\b\d+\s*(?:x|vezes|parcelas)\b/gi,' ').replace(/\b20\d{2}\b(?=\s*$)/g, match => months.some(m => normalized.includes(m)) ? '' : match);
  if (/-\s*\d/.test(cleaned)) throw new Error('Use um valor positivo para a compra.');
  const amounts = [...cleaned.matchAll(new RegExp(money,'g'))];
  if (amounts.length > 1) throw new Error('Encontrei mais de um valor. Envie uma compra por mensagem e deixe claro se o valor é total ou por parcela.');
  if (!per && amounts.length === 1) draft.totalCents = F.toCents(amounts[0][0]);
  draft.category = categoryFor(text,custom);
  const explicitName = text.match(/(?:nome|compra):\s*([^;]+)/i);
  cleaned = cleaned.replace(new RegExp(`(?:R\\$\\s*)?${money}`, 'gi'),' ')
    .replace(/\bcategoria\s+.+$/i,' ')
    .replace(/\b(?:primeira parcela|primeira fatura|vencimento|parcelas?|parcelad[oa]|vezes|reais|total|hoje|ontem)\b/gi,' ')
    .replace(/\b(?:pix|cr[eé]dito|d[eé]bito|dinheiro|boleto|cart[aã]o)\b/gi,' ')
    .replace(new RegExp(`\\b(?:${months.join('|')})\\b`,'gi'),' ')
    .replace(/^(?:gastei|paguei|comprei|compramos|registrar|registre|adicionar)\s*/i,'')
    .replace(/\b(?:por|via|no|na|nos|nas|com|em|de|do|da|um|uma|a|o|e)\b/gi,' ')
    .replace(/[;,.:]+/g,' ').replace(/\s+/g,' ').trim();
  draft.name = (explicitName?.[1] || cleaned).trim();
  return draft;
}

function handleMessage(text, conversation = {}, originalData = blank(), options = {}) {
  const today = options.today || F.todayISO();
  const data = F.validateBackup(originalData);
  const state = structuredClone(conversation);
  const normalized = key(text);
  let changed = false;
  const result = (reply, extra = {}) => ({ reply, state, data, changed, ...extra });
  const categories = F.getCategories(data.customCategories);
  function finish(draft, replacing = null) {
    const field = !draft.name ? 'name' : !draft.totalCents ? 'amount' : !draft.installments ? 'installments' : !draft.category ? 'category' : null;
    if (field) {
      state.pending = { draft, field, replacing };
      const prompts = {name:'Qual é o nome da compra?', amount:'Qual foi o valor total? Exemplo: 300,00.', installments:'Em quantas parcelas? Envie um número de 2 a 120.', category:'Qual é a categoria? Escolha uma abaixo ou use “criar categoria Transporte”.'};
      return result(prompts[field], { actions: field === 'category' ? categories.map(c => c.label).slice(0,12) : ['Cancelar'] });
    }
    const expense = F.createExpense(draft,replacing?.id || options.expenseId,data.customCategories);
    if (replacing) {
      const current = data.expenses.find(e => e.id === replacing.id);
      if (JSON.stringify(current) !== JSON.stringify(replacing)) { delete state.pending; return result('Essa compra mudou no painel. Consulte a versão atual antes de corrigir pelo chat.'); }
      data.expenses = data.expenses.map(e => e.id === replacing.id ? expense : e);
    } else data.expenses.push(expense);
    F.validateBackup(data);
    state.lastOperation = structuredClone({ before:replacing, after:expense });
    delete state.pending; changed = true;
    const portions = F.allocateInstallments(expense.totalCents,expense.installments);
    return result(`${replacing ? 'Atualizei' : 'Registrei'} “${expense.name}”.\n${categories.find(c => c.id === expense.category)?.label || data.customCategories.find(c => c.id === expense.category)?.label} · ${F.formatCurrency(expense.totalCents)} no total${expense.paymentMethod ? ' · '+payments[expense.paymentMethod] : ''}\n${expense.installments > 1 ? `${expense.installments} parcelas: ${portions.map((p,i) => `${F.addMonths(expense.date.slice(0,7),i)}: ${F.formatCurrency(p)}`).join(' · ')}` : 'Pagamento em uma vez.'}\nData da compra / primeira parcela: ${expense.date.split('-').reverse().join('/')}.`, { actions:['Desfazer último gasto','Relatório deste mês'] });
  }
  try {
    if (/^(cancelar|cancela|deixa pra la)$/.test(normalized)) { delete state.pending; return result('Certo, cancelei os detalhes pendentes. Nenhum gasto foi alterado.'); }
    if (/^(ajuda|oi|ola|menu|exemplos)[!.?]*$/.test(normalized)) return result(help);
    if (/^(desfazer|desfaca)( ultimo gasto| ultimo lancamento)?[.!]?$/.test(normalized)) {
      const operation = state.lastOperation;
      if (!operation) return result('Não há um lançamento recente do chat para desfazer.');
      const current = data.expenses.find(e => e.id === operation.after.id);
      if (JSON.stringify(current) !== JSON.stringify(operation.after)) return result('Essa compra foi alterada ou excluída depois. Não vou desfazer uma versão diferente; confira o painel.');
      data.expenses = operation.before ? data.expenses.map(e => e.id === current.id ? operation.before : e) : data.expenses.filter(e => e.id !== current.id);
      delete state.lastOperation; delete state.pending; changed = true;
      return result('Desfiz o último lançamento do chat, incluindo suas parcelas.');
    }
    if (/^(relatorio|resumo|grafico|quanto|qual|quais|mostr[ae]|me mostr[ae])\b/.test(normalized)) {
      if (/\b(ano|semana|dia|hoje|ontem)\b/.test(normalized)) return result('Por enquanto, os relatórios são mensais. Peça “relatório deste mês” ou “relatório de setembro de 2026”.');
      const month = dateFrom(text,today,true).slice(0,7);
      const category = categoryFor(text,data.customCategories);
      if (/\b(com|categoria)\s+/.test(normalized) && !category) return result('Não reconheci uma categoria única. Use o nome cadastrado: '+categories.map(c => c.label).join(', ')+'.');
      const entries = F.entriesForMonth(data.expenses,month).filter(e => !category || e.category === category);
      const summary = F.summarize(entries,data.customCategories);
      const label = category ? categories.find(c => c.id === category).label : 'Todas as categorias';
      return result(`Relatório de ${month.slice(5)}/${month.slice(0,4)} · ${label}\nTotal: ${F.formatCurrency(summary.totalCents)} em ${summary.count} lançamento(s).\nParcelas no mês: ${F.formatCurrency(summary.installmentCents)}.${summary.largestEntry ? `\nMaior gasto: ${summary.largestEntry.name} · ${F.formatCurrency(summary.largestEntry.amountCents)}.` : '\nNenhum gasto neste período.'}${data.budgets[month] !== undefined && !category ? `\nOrçamento restante: ${F.formatCurrency(data.budgets[month]-summary.totalCents)}.` : ''}`, { report:{month,label,totalCents:summary.totalCents,categories:summary.byCategory.map(c => ({label:c.label,color:c.color,totalCents:c.totalCents}))} });
    }
    if (/^corrigir ultimo (gasto|lancamento)/.test(normalized)) {
      const last = state.lastOperation?.after;
      const current = last && data.expenses.find(e => e.id === last.id);
      if (!current) return result('Não encontrei um lançamento recente do chat para corrigir.');
      state.pending = { draft:structuredClone(current), field:'correction', replacing:structuredClone(current) };
      const correction = text.split(':').slice(1).join(':').trim();
      if (!correction) return result('O que deseja corrigir? Envie “valor 90”, “nome Almoço”, “categoria Restaurantes”, “parcelas 3” ou “data 20/09/2026”.');
      text = correction;
    }
    if (state.pending) {
      if (/^(gastei|paguei|comprei|compramos|registrar|registre|adicionar)\b/.test(key(text))) return result('Há uma compra com detalhes pendentes. Responda à última pergunta ou digite “cancelar” antes de enviar outra compra.');
      const {draft,field,replacing} = state.pending;
      if (field === 'name') draft.name = text.trim();
      if (field === 'amount') draft.totalCents = F.toCents(text);
      if (field === 'installments') { if (!/^\d+$/.test(text.trim())) throw new Error('Informe somente o número de parcelas.'); draft.installments = Number(text); if (draft.installments < 2 || draft.installments > 120) throw new Error('Escolha de 2 a 120 parcelas.'); }
      if (field === 'category') {
        if (/^criar categoria\s+/i.test(text)) {
          const category = F.createCategory(text.replace(/^criar categoria\s+/i,''),data.customCategories);
          data.customCategories.push(category); draft.category = category.id; changed = true;
        } else draft.category = categoryFor(text,data.customCategories);
      }
      if (field === 'correction') {
        const match = text.match(/^(valor|nome|categoria|parcelas|data|pagamento)\s+(.+)$/i);
        if (!match) throw new Error('Use “valor 90”, “nome Almoço”, “categoria Mercado”, “parcelas 3”, “pagamento Pix” ou “data 20/09/2026”.');
        const value = match[2];
        switch (key(match[1])) {
          case 'valor': draft.totalCents = F.toCents(value); break;
          case 'nome': draft.name = value; break;
          case 'categoria': draft.category = categoryFor(value,data.customCategories); break;
          case 'parcelas': draft.installments = /^\d+$/.test(value) ? Number(value) : NaN; break;
          case 'data': draft.date = dateFrom(value,today); if (!draft.date) throw new Error('Use uma data como 20/09/2026.'); break;
          case 'pagamento': {
            const method = key(value);
            if (!payments[method]) throw new Error('Use Pix, crédito, débito, dinheiro ou boleto.');
            if (method === 'credito' && draft.paymentMethod !== 'credito') draft.date = nextBillingDate(draft.date);
            draft.paymentMethod = method;
            break;
          }
        }
      }
      return finish(draft,replacing);
    }
    if (/^(gastei|paguei|comprei|compramos|registrar|registre|adicionar)\b/.test(normalized)) return finish(parseExpense(text,data.customCategories,today));
    return result(help);
  } catch (error) {
    // Validation failures never partially change either financial data or the conversation.
    return {reply:error.message+' Envie novamente ou digite “cancelar”.',state:structuredClone(conversation),data:F.validateBackup(originalData),changed:false};
  }
}
module.exports = { handleMessage, parseExpense, blank };
