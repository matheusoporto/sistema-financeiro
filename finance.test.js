'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Finance = require('./finance.js');

function purchase(overrides = {}) {
  return Finance.createExpense({
    name: 'Compra de teste', category: 'online', totalCents: 10000,
    installments: 3, date: '2026-01-31', notes: '',
    createdAt: '2026-01-31T15:00:00.000Z', ...overrides
  }, overrides.id || 'test-purchase');
}

function backup(overrides = {}) {
  return { version: 1, expenses: [purchase()], budgets: { '2026-01': 150000 }, preferences: { selectedMonth: '2026-01', filters: [] }, ...overrides };
}

test('parse BRL values into exact integer cents and reject malformed amounts', () => {
  assert.equal(Finance.toCents('1.234,56'), 123456);
  assert.equal(Finance.toCents('R$ 19,90'), 1990);
  assert.equal(Finance.toCents('1.234'), 123400);
  assert.equal(Finance.toCents('1234.56'), 123456);
  assert.equal(Finance.toCents('0,01'), 1);
  assert.equal(Finance.toCents(19.9), 1990);
  assert.equal(Finance.toCents(1.005), 101);
  for (const invalid of ['', '12abc', '1,234', '12.34,56', NaN, Infinity, {}, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => Finance.toCents(invalid));
  }
});

test('installments preserve every cent and put remainders in the first installments', () => {
  assert.deepEqual(Finance.allocateInstallments(10000, 3), [3334, 3333, 3333]);
  assert.deepEqual(Finance.allocateInstallments(1, 3), [1, 0, 0]);
  for (const cents of [1, 99, 10000, 123456789, Number.MAX_SAFE_INTEGER]) {
    for (const count of [1, 2, 3, 7, 12, 120]) {
      const values = Finance.allocateInstallments(cents, count);
      assert.equal(values.reduce((sum, value) => sum + BigInt(value), 0n), BigInt(cents));
      assert.ok(Math.max(...values) - Math.min(...values) <= 1);
      assert.ok(values.every(Number.isSafeInteger));
    }
  }
  for (const count of [0, -1, 1.5, 121, '3']) assert.throws(() => Finance.allocateInstallments(100, count));
});

test('month arithmetic handles crossing years in both directions', () => {
  assert.equal(Finance.addMonths('2026-12', 1), '2027-01');
  assert.equal(Finance.addMonths('2026-01', -1), '2025-12');
  assert.equal(Finance.addMonths('2026-09', 120), '2036-09');
  assert.equal(Finance.addMonths('0099-12', 1), '0100-01');
  assert.throws(() => Finance.addMonths('2026-13', 0));
  assert.throws(() => Finance.addMonths('2026-01', 0.5));
  assert.throws(() => Finance.addMonths('0001-01', -1));
  assert.throws(() => Finance.addMonths('9999-12', 1));
});

test('purchases and imported backups cannot create installments worth zero cents', () => {
  assert.throws(() => purchase({ totalCents: 1, installments: 120 }), /Cada parcela deve ter pelo menos/);
  assert.throws(() => purchase({ totalCents: 119, installments: 120 }), /Cada parcela deve ter pelo menos/);
  const smallestInstallments = purchase({ totalCents: 120, installments: 120 });
  const entries = Finance.buildEntries([smallestInstallments]);
  assert.equal(entries.length, 120);
  assert.ok(entries.every(entry => entry.amountCents === 1));
  assert.equal(Finance.buildEntries([purchase({ totalCents: 1, installments: 1 })])[0].amountCents, 1);
  assert.throws(() => Finance.validateBackup(backup({ expenses: [{ ...purchase(), totalCents: 1, installments: 2 }] })), /Cada parcela deve ter pelo menos/);
});

test('installment dates clamp to month ends without drifting the following months', () => {
  const entries = Finance.buildEntries([purchase()]);
  assert.deepEqual(entries.map(entry => entry.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.deepEqual(entries.map(entry => entry.amountCents), [3334, 3333, 3333]);
  assert.deepEqual(entries.map(entry => entry.installmentNumber), [1, 2, 3]);
  assert.equal(entries[2].id, 'test-purchase-3');
  assert.equal(entries[2].expenseId, 'test-purchase');
  const leapYear = Finance.buildEntries([purchase({ date: '2028-01-31' })]);
  assert.equal(leapYear[1].date, '2028-02-29');
  const century = Finance.buildEntries([purchase({ date: '2100-01-31' })]);
  assert.equal(century[1].date, '2100-02-28');
  const yearEnd = Finance.buildEntries([purchase({ date: '2026-12-31' })]);
  assert.deepEqual(yearEnd.map(entry => entry.month), ['2026-12', '2027-01', '2027-02']);
});

test('expense validation rejects impossible dates, unknown categories and coercion', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-01-00', '2026-13-01', '2026-1-01', '0000-01-01']) {
    assert.throws(() => purchase({ date }));
  }
  assert.doesNotThrow(() => purchase({ date: '2028-02-29' }));
  for (const overrides of [
    { category: 'outros' }, { name: '  ' }, { name: 'x'.repeat(101) },
    { totalCents: '1000' }, { totalCents: 0 }, { totalCents: 0.5 },
    { installments: '3' }, { installments: 121 }, { notes: 'x'.repeat(501) },
    { id: '<script>' }, { createdAt: '2026-02-31T15:00:00.000Z' },
    { date: '9999-12-31', installments: 2 }
  ]) assert.throws(() => purchase(overrides));
  assert.equal(purchase({ name: '  Mercado  ' }).name, 'Mercado');
  assert.equal(Finance.monthKey('2028-02-29'), '2028-02');
  assert.match(Finance.todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('monthly summary counts installments and sorts category totals', () => {
  const expenses = [
    purchase(),
    purchase({ id: 'groceries', name: 'Mercado', category: 'mercado', totalCents: 8000, installments: 1 }),
    purchase({ id: 'delivery', name: 'Almoço', category: 'ifood', totalCents: 2500, installments: 1 }),
    purchase({ id: 'delivery2', name: 'Jantar', category: 'ifood', totalCents: 4000, installments: 1 })
  ];
  const entries = Finance.entriesForMonth(expenses, '2026-01');
  const summary = Finance.summarize(entries);
  assert.equal(summary.totalCents, 17834);
  assert.equal(summary.count, 4);
  assert.equal(summary.installmentCents, 3334);
  assert.equal(summary.installmentCount, 1);
  assert.equal(summary.largestEntry.name, 'Mercado');
  assert.deepEqual(summary.byCategory.map(category => [category.id, category.totalCents, category.count]), [
    ['mercado', 8000, 1], ['ifood', 6500, 2], ['online', 3334, 1]
  ]);
  assert.equal(Finance.entriesForMonth(expenses, '2026-02').length, 1);
  assert.deepEqual(Finance.summarize([]), { totalCents: 0, count: 0, installmentCents: 0, installmentCount: 0, largestEntry: null, byCategory: [] });
});

test('backup validation returns independent normalized data', () => {
  const original = backup();
  const normalized = Finance.validateBackup(original);
  assert.deepEqual(normalized, { ...original, customCategories: [] });
  normalized.expenses[0].name = 'Alterado';
  normalized.budgets['2026-01'] = 1;
  normalized.preferences.filters.push('mercado');
  assert.equal(original.expenses[0].name, 'Compra de teste');
  assert.equal(original.budgets['2026-01'], 150000);
  assert.deepEqual(original.preferences.filters, []);
});

test('backup validation rejects incompatible, duplicated and unsafe data', () => {
  for (const invalid of [
    null, [], backup({ version: 2 }), backup({ version: '1' }),
    backup({ expenses: {} }), backup({ expenses: [purchase(), purchase()] }),
    backup({ expenses: [{ ...purchase(), totalCents: '10000' }] }),
    backup({ expenses: [{ ...purchase(), date: '2026-02-30' }] }),
    backup({ expenses: [{ ...purchase(), id: undefined }] }),
    backup({ expenses: [{ ...purchase(), createdAt: undefined }] }),
    backup({ budgets: { '2026-13': 100 } }), backup({ budgets: { '2026-01': -1 } }),
    backup({ budgets: { '2026-01': '100' } }), backup({ preferences: [] }),
    backup({ preferences: JSON.parse('{"__proto__":{"polluted":true}}') }),
    backup({ preferences: { theme: () => {} } })
  ]) assert.throws(() => Finance.validateBackup(invalid));
  assert.equal({}.polluted, undefined);
});

test('custom categories normalize names without mutating built-in categories or caller data', () => {
  const category = Finance.createCategory('  Cuidados   com\t pets  ');
  assert.equal(category.label, 'Cuidados com pets');
  assert.match(category.id, /^custom-[A-Za-z0-9_-]{1,93}$/);
  assert.match(category.color, /^#[0-9a-fA-F]{6}$/);
  assert.equal(category.icon, 'receipt');
  assert.ok(Object.isFrozen(Finance.CATEGORIES));
  assert.ok(Finance.CATEGORIES.every(Object.isFrozen));
  const customCategories = [category];
  const categories = Finance.getCategories(customCategories);
  assert.equal(categories.length, 8);
  assert.deepEqual(categories.slice(0, 7), Finance.CATEGORIES);
  categories[7].label = 'Alterada';
  assert.equal(category.label, 'Cuidados com pets');
  assert.equal(Finance.CATEGORIES.length, 7);
  assert.equal(customCategories.length, 1);
});

test('custom category names reject duplicates, empty labels and excess length', () => {
  const customCategories = [Finance.createCategory('Educação extra')];
  for (const label of ['Farmácia', '  FARMACIA  ', 'Assinaturas', ' EDUCACAO   EXTRA ', 'Educa\u0301ção extra']) {
    assert.throws(() => Finance.createCategory(label, customCategories), /Já existe/);
  }
  for (const label of ['', ' \t\n ', 'a'.repeat(41), null, 12, {}]) {
    assert.throws(() => Finance.createCategory(label, customCategories));
  }
  assert.equal(Finance.createCategory('a'.repeat(40)).label.length, 40);
  assert.equal(Finance.createCategory('Curso < 100 "reais"').label, 'Curso < 100 "reais"');
});

test('custom categories support installment summaries and JSON backup round trips', () => {
  const customCategories = [Finance.createCategory('Educação'), Finance.createCategory('Pets')];
  const customExpense = Finance.createExpense({ ...purchase(), category: customCategories[0].id }, 'course', customCategories);
  const original = backup({ customCategories, expenses: [customExpense] });
  const restored = Finance.validateBackup(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(restored, original);
  const summary = Finance.summarize(Finance.entriesForMonth(restored.expenses, '2026-01'), restored.customCategories);
  assert.equal(summary.totalCents, 3334);
  assert.equal(summary.installmentCount, 1);
  assert.deepEqual(summary.byCategory, [{ ...customCategories[0], totalCents: 3334, count: 1 }]);
  restored.customCategories[0].label = 'Alterada';
  assert.equal(original.customCategories[0].label, 'Educação');
  assert.throws(() => Finance.createExpense(customExpense, 'unknown'), /tipo de gasto/);
  assert.throws(() => Finance.summarize(Finance.buildEntries([customExpense])), /dados inválidos/);
  assert.throws(() => Finance.validateBackup(backup({ expenses: [customExpense] })), /tipo de gasto/);
});

test('legacy version 1 backups restore default categories and normalize a missing custom list', () => {
  const restored = Finance.validateBackup(JSON.parse(JSON.stringify(backup())));
  assert.equal(restored.version, 1);
  assert.deepEqual(restored.customCategories, []);
  assert.deepEqual(Finance.getCategories(restored.customCategories), Finance.CATEGORIES);
  assert.equal(Finance.summarize(Finance.entriesForMonth(restored.expenses, '2026-01'), restored.customCategories).totalCents, 3334);
});

test('custom category imports reject unsafe metadata and duplicates while allowing plain text labels', () => {
  const category = Finance.createCategory('<img src=x onerror="alert(1)">');
  const restored = Finance.validateBackup(backup({ customCategories: [category] }));
  assert.equal(restored.customCategories[0].label, category.label);
  const invalidCategories = [
    null, { ...category, id: 'online' }, { ...category, id: 'custom-" onclick="alert(1)' },
    { ...category, id: 'custom-' }, { ...category, id: 'custom-' + 'a'.repeat(94) },
    { ...category, color: 'red' }, { ...category, color: '#abc' },
    { ...category, color: '#123456;background:url(x)' }, { ...category, color: '#123456" onmouseover="x' },
    { ...category, icon: '<svg onload=alert(1)>' }, { ...category, icon: 'online' },
    { ...category, label: '  farmacia ' }
  ];
  for (const invalid of invalidCategories) {
    assert.throws(() => Finance.getCategories([invalid]));
    assert.throws(() => Finance.validateBackup(backup({ customCategories: [invalid] })));
  }
  assert.throws(() => Finance.validateBackup(backup({ customCategories: null })));
  assert.throws(() => Finance.validateBackup(backup({ customCategories: {} })));
  assert.throws(() => Finance.validateBackup(backup({ customCategories: [category, { ...category, label: 'Outra' }] })), /identificadores/);
  assert.throws(() => Finance.validateBackup(backup({ customCategories: [category, { ...category, id: 'custom-other' }] })), /Já existe/);
});

test('custom categories enforce the account limit on both creation and import', () => {
  const categories = Array.from({ length: 100 }, (_, index) => ({ id: 'custom-' + index, label: 'Categoria ' + index, color: '#123456', icon: 'receipt' }));
  assert.equal(Finance.getCategories(categories).length, 107);
  assert.throws(() => Finance.createCategory('Categoria extra', categories), /até 100/);
  assert.throws(() => Finance.validateBackup(backup({ customCategories: [...categories, { ...categories[0], id: 'custom-100', label: 'Categoria 100' }] })), /até 100/);
});
