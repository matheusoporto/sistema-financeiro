'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Only migration knows the old database/environment names.
function databasePath(directory, env = process.env) {
  if (env.MONEYRESTLY_DB) return env.MONEYRESTLY_DB;
  if (env.FINANTO_DB) {
    throw new Error('Renomeie a variavel de banco antiga para MONEYRESTLY_DB, mantendo o caminho dos seus dados.');
  }
  const target = path.join(directory, 'moneyrestly.sqlite');
  if (fs.existsSync(target)) return target;
  const sources = ['finanto.sqlite', 'orcaviva.sqlite'].map(name => path.join(directory, name)).filter(file => fs.existsSync(file));
  if (sources.length > 1) throw new Error('Mais de um banco anterior encontrado. Defina MONEYRESTLY_DB explicitamente.');
  if (sources.length) {
    const source = new DatabaseSync(sources[0], {readOnly: true});
    try {
      // SQLite snapshot includes committed WAL data, unlike copying the main file.
      source.exec("VACUUM INTO '" + target.replaceAll("'", "''") + "'");
    } finally { source.close(); }
  }
  return target;
}
module.exports = { databasePath };
