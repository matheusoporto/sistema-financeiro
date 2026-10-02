/* One-time compatibility bridge. Old brand names belong only in migration code. */
(() => {
  'use strict';
  const prefixes = ['finanto.', 'orcaviva.'];
  function migrate(storage) {
    const keys = Array.from({length: storage.length}, (_, i) => storage.key(i));
    for (const key of keys) {
      const prefix = prefixes.find(prefix => key?.startsWith(prefix));
      if (!prefix) continue;
      const target = 'moneyrestly.' + key.slice(prefix.length);
      let value = storage.getItem(key);
      if (key.endsWith('.pending-pointer')) {
        const old = prefixes.find(prefix => value?.startsWith(prefix));
        if (old) value = 'moneyrestly.' + value.slice(old.length);
      }
      // Never overwrite newer data. Keep conflicting legacy entries recoverable.
      const existing = storage.getItem(target);
      if (existing !== null && existing !== value) continue;
      storage.setItem(target, value);
      if (storage.getItem(target) === value) storage.removeItem(key);
    }
  }
  for (const name of ['localStorage', 'sessionStorage']) {
    try { migrate(window[name]); } catch { /* Preserve source if storage is unavailable/full. */ }
  }
})();
