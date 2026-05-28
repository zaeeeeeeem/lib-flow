const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database', 'libraflow.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'database', 'schema.sql');

function initDb() {
  console.log('🗄️  Initializing LibraFlow database...');
  const db = new Database(DB_PATH);
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

  // Split by semicolon, trim, filter empty
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  const run = db.transaction(() => {
    for (const stmt of statements) {
      try {
        db.prepare(stmt).run();
      } catch (e) {
        // Ignore "already exists" errors for triggers/tables
        if (!e.message.includes('already exists') && !e.message.includes('UNIQUE constraint')) {
          console.warn('⚠️  Skipped:', e.message.slice(0, 80));
        }
      }
    }
  });

  run();
  db.close();
  console.log('✅ Database ready at', DB_PATH);
}

initDb();
module.exports = initDb;
