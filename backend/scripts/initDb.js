const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'database', 'libraflow.db');
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'database', 'schema.sql');

function initDb() {
  console.log('🗄️  Initializing LibraFlow database...');

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  db.exec(schema);

  db.close();
  console.log('✅ Database ready at', DB_PATH);
}

initDb();
module.exports = initDb;
