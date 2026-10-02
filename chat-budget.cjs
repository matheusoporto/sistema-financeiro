'use strict';
const F = require('./finance.js');
const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const months = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const isBudget = text => /^(?:(?:definir|defina|ajustar|ajuste|alterar|altere) (?:o )?orcamento\b|orcamento\b|recebi\b)/.test(normalize(text));
function parseBudget(text, today) {
  let value = normalize(text);
  if (/\b(?:nao|talvez|se|somar|some|adicionar|adicione|mais|mil|milhao)\b|us\$|usd|eur|€|dolar|euro/.test(value)) throw new Error('Informe um valor total em reais, em números. O comando define o orçamento; não soma recebimentos.');
  const found = [];
  const year = today.slice(0,4);
  const collect = (pattern, resolve) => {value = value.replace(pattern,(...args) => {found.push(resolve(...args));return ' ';});};
  collect(/\b(\d{4})-(\d{2})\b/g,(_,y,m)=>`${y}-${m}`);
  collect(/\b(\d{1,2})\/(\d{4})\b/g,(_,m,y)=>`${y}-${m.padStart(2,'0')}`);
  collect(new RegExp(`\\b(${months.join('|')})(?:\\s+(?:de\\s+)?(\\d{4})(?![\\d.,]))?\\b`,'g'),(_,m,y)=>`${y || year}-${String(months.indexOf(m)+1).padStart(2,'0')}`);
  collect(/\b(?:(?:este|esse|neste|nesse|deste|desse) mes|mes atual)\b/g,()=>today.slice(0,7));
  collect(/\b(?:proximo mes|mes que vem)\b/g,()=>F.addMonths(today.slice(0,7),1));
  collect(/\b(?:mes passado|mes anterior)\b/g,()=>F.addMonths(today.slice(0,7),-1));
  collect(/\bmes\s+(\d{1,2})(?![\d.,])\b/g,(_,m)=>`${year}-${m.padStart(2,'0')}`);
  if (found.length > 1) throw new Error('Informe somente um mês por mensagem.');
  const month = found[0];
  if (month) F.addMonths(month,0);
  if (/[\/]|\b(?:mes|janeiro|fevereiro)\s+\d/.test(value)) throw new Error('Use o mês por extenso, MM/AAAA ou AAAA-MM.');
  const amounts = [...value.matchAll(/[+-]?\s*\d[\d.,]*/g)].map(match=>match[0].trim().replace(/[.,]$/,''));
  if (amounts.length > 1) throw new Error('Informe apenas um valor total para o orçamento.');
  let amount;
  if (amounts.length) {
    if (/^[+-]/.test(amounts[0])) throw new Error('Use um orçamento positivo em reais.');
    amount = F.toCents(amounts[0]);
  }
  return {month,amount};
}
module.exports = {isBudget,parseBudget};
