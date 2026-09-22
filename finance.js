(function (root, factory) {
  'use strict';
  var finance = factory();
  if (typeof module === 'object' && module.exports) module.exports = finance;
  else root.Finance = finance;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CATEGORIES = Object.freeze([
    { id: 'ifood', label: 'Ifood', color: '#ef8e78', icon: 'ifood' },
    { id: 'online', label: 'Online', color: '#8b83da', icon: 'online' },
    { id: 'restaurantes', label: 'Restaurantes', color: '#dfaa5b', icon: 'restaurantes' },
    { id: 'mercado', label: 'Mercado', color: '#4f9e82', icon: 'mercado' },
    { id: 'farmacia', label: 'Farmácia', color: '#6baac1', icon: 'farmacia' },
    { id: 'assinaturas', label: 'Assinaturas', color: '#bd87ad', icon: 'assinaturas' },
    { id: 'lazer', label: 'Lazer', color: '#94ac63', icon: 'lazer' }
  ].map(Object.freeze));
  const CUSTOM_CATEGORY_COLORS = Object.freeze(['#5b8dbe', '#c48853', '#9278b8', '#539c91', '#bd7185', '#879c53', '#6683b6', '#aa8469']);
  const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  }

  function normalizeCategoryLabel(label) {
    assert(typeof label === 'string', 'Informe o nome da categoria.');
    const normalized = label.trim().replace(/\s+/g, ' ');
    assert(normalized.length >= 1 && normalized.length <= 40, 'O nome da categoria deve ter entre 1 e 40 caracteres.');
    return normalized;
  }

  function categoryLabelKey(label) {
    return normalizeCategoryLabel(label).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  }

  function validateCustomCategories(customCategories) {
    assert(Array.isArray(customCategories), 'A lista de categorias é inválida.');
    assert(customCategories.length <= 100, 'Você pode criar até 100 categorias personalizadas.');
    const ids = new Set(CATEGORIES.map(category => category.id));
    const labels = new Set(CATEGORIES.map(category => categoryLabelKey(category.label)));
    return customCategories.map(category => {
      assert(isPlainObject(category), 'Uma categoria contém dados inválidos.');
      assert(typeof category.id === 'string' && /^custom-[A-Za-z0-9_-]{1,93}$/.test(category.id), 'O identificador da categoria é inválido.');
      assert(!ids.has(category.id), 'Há identificadores de categorias repetidos.');
      const label = normalizeCategoryLabel(category.label);
      const labelKey = categoryLabelKey(label);
      assert(!labels.has(labelKey), 'Já existe uma categoria com esse nome.');
      assert(typeof category.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(category.color), 'A cor da categoria é inválida.');
      assert(category.icon === 'receipt', 'O ícone da categoria é inválido.');
      ids.add(category.id);
      labels.add(labelKey);
      return { id: category.id, label, color: category.color, icon: 'receipt' };
    });
  }

  function getCategories(customCategories = []) {
    return [...CATEGORIES, ...validateCustomCategories(customCategories)];
  }

  function createCategory(label, customCategories = []) {
    const categories = getCategories(customCategories);
    assert(customCategories.length < 100, 'Você pode criar até 100 categorias personalizadas.');
    const normalizedLabel = normalizeCategoryLabel(label);
    const labelKey = categoryLabelKey(normalizedLabel);
    assert(!categories.some(category => categoryLabelKey(category.label) === labelKey), 'Já existe uma categoria com esse nome.');
    const baseId = 'custom-' + makeId();
    let id = baseId;
    let suffix = 1;
    while (categories.some(category => category.id === id)) id = baseId + '-' + suffix++;
    return { id, label: normalizedLabel, color: CUSTOM_CATEGORY_COLORS[customCategories.length % CUSTOM_CATEGORY_COLORS.length], icon: 'receipt' };
  }

  function validCents(value, allowZero) {
    return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
  }

  function toCents(value) {
    if (typeof value === 'number') {
      assert(Number.isFinite(value), 'Informe um valor válido.');
      const sign = value < 0 ? -1 : 1;
      const cents = sign * Math.round((Math.abs(value) + Number.EPSILON) * 100);
      assert(Number.isSafeInteger(cents), 'O valor informado é muito alto.');
      return cents;
    }
    assert(typeof value === 'string', 'Informe um valor válido.');
    let normalized = value.trim().replace(/^R\$\s*/, '');
    assert(normalized.length > 0, 'Informe o valor da compra.');
    const sign = normalized.startsWith('-') ? -1 : 1;
    if (sign < 0) normalized = normalized.slice(1);
    let whole;
    let decimals;
    if (normalized.includes(',')) {
      assert(/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(normalized), 'Use um valor como 1.234,56.');
      [whole, decimals] = normalized.split(',');
      whole = whole.replace(/\./g, '');
    } else if (/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
      whole = normalized.replace(/\./g, '');
      decimals = '';
    } else {
      assert(/^\d+(?:\.\d{1,2})?$/.test(normalized), 'Use um valor como 1.234,56.');
      [whole, decimals = ''] = normalized.split('.');
    }
    const cents = sign * (Number(whole) * 100 + Number(decimals.padEnd(2, '0')));
    assert(Number.isSafeInteger(cents), 'O valor informado é muito alto.');
    return cents;
  }

  function allocateInstallments(totalCents, count) {
    assert(validCents(totalCents, false), 'O valor total deve ser maior que zero.');
    assert(Number.isInteger(count) && count >= 1 && count <= 120, 'Escolha de 1 a 120 parcelas.');
    const base = Math.floor(totalCents / count);
    const remainder = totalCents % count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
  }

  function parseMonth(value) {
    assert(typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value), 'O mês informado é inválido.');
    const [year, month] = value.split('-').map(Number);
    assert(year >= 1, 'O ano informado é inválido.');
    return { year, month };
  }

  function daysInMonth(year, month) {
    if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
  }

  function parseDate(value) {
    assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Informe uma data válida.');
    const { year, month } = parseMonth(value.slice(0, 7));
    const day = Number(value.slice(8));
    assert(day >= 1 && day <= daysInMonth(year, month), 'Informe uma data válida.');
    return { year, month, day };
  }

  function addMonths(monthString, offset) {
    const { year, month } = parseMonth(monthString);
    assert(Number.isSafeInteger(offset), 'O intervalo de meses é inválido.');
    const absoluteMonth = year * 12 + month - 1 + offset;
    const nextYear = Math.floor(absoluteMonth / 12);
    const nextMonth = absoluteMonth % 12 + 1;
    assert(nextYear >= 1 && nextYear <= 9999, 'A data está fora do intervalo permitido.');
    return String(nextYear).padStart(4, '0') + '-' + String(nextMonth).padStart(2, '0');
  }

  function todayISO() {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function monthKey(dateString) {
    parseDate(dateString);
    return dateString.slice(0, 7);
  }

  function formatCurrency(cents) {
    assert(Number.isSafeInteger(cents), 'O valor informado é inválido.');
    return currencyFormatter.format(cents / 100);
  }

  function makeId() {
    if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return 'expense-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function isValidTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
  }

  function createExpense(input, id, customCategories = []) {
    const categoryIds = new Set(getCategories(customCategories).map(category => category.id));
    assert(isPlainObject(input), 'Os dados da compra são inválidos.');
    assert(typeof input.name === 'string' && input.name.trim().length >= 1 && input.name.trim().length <= 100, 'O nome deve ter entre 1 e 100 caracteres.');
    assert(categoryIds.has(input.category), 'Selecione um tipo de gasto válido.');
    assert(validCents(input.totalCents, false), 'Informe um valor maior que zero.');
    assert(Number.isInteger(input.installments) && input.installments >= 1 && input.installments <= 120, 'Escolha de 1 a 120 parcelas.');
    assert(input.totalCents >= input.installments, 'Cada parcela deve ter pelo menos R$ 0,01. Reduza o número de parcelas.');
    parseDate(input.date);
    addMonths(input.date.slice(0, 7), input.installments - 1);
    assert(input.notes === undefined || (typeof input.notes === 'string' && input.notes.length <= 500), 'A observação deve ter no máximo 500 caracteres.');
    assert(input.paymentMethod === undefined || ['pix','credito','debito','dinheiro','boleto'].includes(input.paymentMethod), 'A forma de pagamento é inválida.');
    const expenseId = id === undefined ? (input.id === undefined ? makeId() : input.id) : id;
    assert(typeof expenseId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(expenseId), 'O identificador da compra é inválido.');
    const createdAt = input.createdAt === undefined ? new Date().toISOString() : input.createdAt;
    assert(isValidTimestamp(createdAt), 'A data de criação é inválida.');
    return {
      id: expenseId,
      name: input.name.trim(),
      category: input.category,
      totalCents: input.totalCents,
      installments: input.installments,
      date: input.date,
      notes: (input.notes || '').trim(),
      ...(input.paymentMethod ? {paymentMethod:input.paymentMethod} : {}),
      createdAt
    };
  }

  function buildEntries(expenses) {
    assert(Array.isArray(expenses), 'A lista de compras é inválida.');
    return expenses.flatMap(expense => {
      const { day } = parseDate(expense.date);
      return allocateInstallments(expense.totalCents, expense.installments).map((amountCents, index) => {
        const month = addMonths(expense.date.slice(0, 7), index);
        const parsedMonth = parseMonth(month);
        const installmentDay = Math.min(day, daysInMonth(parsedMonth.year, parsedMonth.month));
        return {
          id: expense.id + '-' + (index + 1),
          expenseId: expense.id,
          name: expense.name,
          category: expense.category,
          amountCents,
          totalCents: expense.totalCents,
          installmentNumber: index + 1,
          installments: expense.installments,
          date: month + '-' + String(installmentDay).padStart(2, '0'),
          month,
          notes: expense.notes || '',
          ...(expense.paymentMethod ? {paymentMethod:expense.paymentMethod} : {})
        };
      });
    });
  }

  function entriesForMonth(expenses, month) {
    parseMonth(month);
    return buildEntries(expenses).filter(entry => entry.month === month);
  }

  function summarize(entries, customCategories = []) {
    assert(Array.isArray(entries), 'A lista de lançamentos é inválida.');
    const totals = new Map(getCategories(customCategories).map(category => [category.id, { ...category, totalCents: 0, count: 0 }]));
    let totalCents = 0;
    let installmentCents = 0;
    let installmentCount = 0;
    let largestEntry = null;
    for (const entry of entries) {
      assert(validCents(entry.amountCents, true) && totals.has(entry.category), 'Um lançamento contém dados inválidos.');
      totalCents += entry.amountCents;
      assert(Number.isSafeInteger(totalCents), 'A soma dos gastos ultrapassa o limite permitido.');
      const category = totals.get(entry.category);
      category.totalCents += entry.amountCents;
      category.count += 1;
      if (entry.installments > 1) {
        installmentCents += entry.amountCents;
        installmentCount += 1;
      }
      if (largestEntry === null || entry.amountCents > largestEntry.amountCents) largestEntry = entry;
    }
    return {
      totalCents,
      count: entries.length,
      installmentCents,
      installmentCount,
      largestEntry,
      byCategory: Array.from(totals.values()).filter(category => category.totalCents > 0).sort((a, b) => b.totalCents - a.totalCents)
    };
  }

  function clonePreferences(value, depth) {
    assert(depth < 10, 'As preferências do arquivo são inválidas.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      assert(Number.isFinite(value), 'As preferências do arquivo são inválidas.');
      return value;
    }
    if (Array.isArray(value)) return value.map(item => clonePreferences(item, depth + 1));
    assert(isPlainObject(value), 'As preferências do arquivo são inválidas.');
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      assert(!['__proto__', 'constructor', 'prototype'].includes(key), 'As preferências do arquivo são inválidas.');
      result[key] = clonePreferences(item, depth + 1);
    }
    return result;
  }

  function validateBackup(data) {
    assert(isPlainObject(data) && data.version === 1, 'O arquivo não é um backup compatível (versão 1).');
    assert(Array.isArray(data.expenses), 'O backup não contém uma lista válida de compras.');
    assert(data.expenses.length <= 10000, 'O backup excede o limite de 10.000 compras.');
    const customCategories = validateCustomCategories(data.customCategories === undefined ? [] : data.customCategories);
    const ids = new Set();
    let totalCents = 0;
    const expenses = data.expenses.map(input => {
      assert(isPlainObject(input) && typeof input.id === 'string', 'Uma compra do backup não possui identificador válido.');
      assert(isValidTimestamp(input.createdAt), 'Uma compra do backup não possui data de criação válida.');
      const expense = createExpense(input, input.id, customCategories);
      assert(!ids.has(expense.id), 'O backup contém identificadores de compras repetidos.');
      ids.add(expense.id);
      totalCents += expense.totalCents;
      assert(Number.isSafeInteger(totalCents), 'O valor total do backup ultrapassa o limite permitido.');
      return expense;
    });
    assert(isPlainObject(data.budgets), 'Os limites mensais do backup são inválidos.');
    const budgets = {};
    for (const [month, amount] of Object.entries(data.budgets)) {
      parseMonth(month);
      assert(validCents(amount, true), 'Um limite mensal do backup é inválido.');
      budgets[month] = amount;
    }
    assert(isPlainObject(data.preferences), 'As preferências do backup são inválidas.');
    return { version: 1, customCategories, expenses, budgets, preferences: clonePreferences(data.preferences, 0) };
  }

  return Object.freeze({
    CATEGORIES, getCategories, createCategory, toCents, allocateInstallments, addMonths, todayISO, monthKey,
    formatCurrency, createExpense, buildEntries, entriesForMonth, summarize, validateBackup
  });
});
