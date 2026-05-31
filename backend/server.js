const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Database Setup ──────────────────────────────────────────
const DB_DIR = path.join(__dirname, '..', 'database');
const DB_PATH = path.join(DB_DIR, 'libraflow.db');

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  return db;
}

function ensureDb() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const needsInit = !fs.existsSync(DB_PATH);
  if (needsInit) {
    require('./scripts/initDb');
    return;
  }

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='books'").get();
    if (!row) {
      db.close();
      require('./scripts/initDb');
    }
  } catch (err) {
    if (db) db.close();
    console.warn('⚠️  Database invalid or uninitialized, reinitializing...', err.message);
    require('./scripts/initDb');
  } finally {
    if (db) db.close();
  }
}

// Ensure the DB exists and is initialized
ensureDb();

// ── Helper: calculate fine ──────────────────────────────────
function calcFine(dueDate, returnedAt = null) {
  const due = new Date(dueDate);
  const end = returnedAt ? new Date(returnedAt) : new Date();
  const days = Math.floor((end - due) / (1000 * 60 * 60 * 24));
  return days > 0 ? days * 5 : 0; // PKR 5 per day
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════
app.get('/api/dashboard', (req, res) => {
  const db = getDb();
  try {
    const totalBooks     = db.prepare('SELECT COUNT(*) as c FROM books').get().c;
    const totalMembers   = db.prepare("SELECT COUNT(*) as c FROM members WHERE status='active'").get().c;
    const activeLoans    = db.prepare('SELECT COUNT(*) as c FROM loans WHERE returned_at IS NULL').get().c;
    const overdueLoans   = db.prepare("SELECT COUNT(*) as c FROM loans WHERE returned_at IS NULL AND due_date < date('now')").get().c;

    const recentLoans = db.prepare(`
      SELECT l.id, b.title, m.name as member_name, l.issued_at, l.due_date,
             l.returned_at, b.cover_color
      FROM loans l
      JOIN books b ON b.id = l.book_id
      JOIN members m ON m.id = l.member_id
      ORDER BY l.issued_at DESC LIMIT 8
    `).all();

    const categoryStats = db.prepare(`
      SELECT c.name, c.color, COUNT(b.id) as book_count,
             SUM(b.total_copies - b.available_copies) as on_loan
      FROM categories c
      LEFT JOIN books b ON b.category_id = c.id
      GROUP BY c.id
    `).all();

    // Calculate total fines owed
    const overdueRows = db.prepare(`
      SELECT due_date FROM loans WHERE returned_at IS NULL AND due_date < date('now')
    `).all();
    const totalFines = overdueRows.reduce((sum, r) => sum + calcFine(r.due_date), 0);

    res.json({ totalBooks, totalMembers, activeLoans, overdueLoans, totalFines, recentLoans, categoryStats });
  } finally { db.close(); }
});

// ══════════════════════════════════════════════════════════════
// BOOKS
// ══════════════════════════════════════════════════════════════
app.get('/api/books', (req, res) => {
  const db = getDb();
  try {
    const { search, category } = req.query;
    let query = `
      SELECT b.*, c.name as category_name, c.color as category_color,
             GROUP_CONCAT(a.name, ', ') as authors
      FROM books b
      LEFT JOIN categories c ON c.id = b.category_id
      LEFT JOIN book_authors ba ON ba.book_id = b.id
      LEFT JOIN authors a ON a.id = ba.author_id
    `;
    const params = [];
    const conditions = [];
    if (search) {
      conditions.push("(b.title LIKE ? OR a.name LIKE ? OR b.isbn LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (category) {
      conditions.push("b.category_id = ?");
      params.push(category);
    }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' GROUP BY b.id ORDER BY b.title';

    res.json(db.prepare(query).all(...params));
  } finally { db.close(); }
});

app.get('/api/books/:id', (req, res) => {
  const db = getDb();
  try {
    const book = db.prepare(`
      SELECT b.*, c.name as category_name,
             GROUP_CONCAT(a.name, ', ') as authors
      FROM books b
      LEFT JOIN categories c ON c.id = b.category_id
      LEFT JOIN book_authors ba ON ba.book_id = b.id
      LEFT JOIN authors a ON a.id = ba.author_id
      WHERE b.id = ? GROUP BY b.id
    `).get(req.params.id);

    if (!book) return res.status(404).json({ error: 'Book not found' });

    const loans = db.prepare(`
      SELECT l.*, m.name as member_name
      FROM loans l JOIN members m ON m.id = l.member_id
      WHERE l.book_id = ? ORDER BY l.issued_at DESC LIMIT 10
    `).all(req.params.id);

    res.json({ ...book, loans });
  } finally { db.close(); }
});

app.post('/api/books', (req, res) => {
  const db = getDb();
  try {
    const { title, isbn, category_id, published_year, total_copies, description, cover_color, author_ids } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const copies = parseInt(total_copies) || 1;
    const result = db.prepare(`
      INSERT INTO books (title, isbn, category_id, published_year, total_copies, available_copies, description, cover_color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, isbn || null, category_id || null, published_year || null, copies, copies, description || null, cover_color || '#6366f1');

    if (author_ids && author_ids.length) {
      const insertBA = db.prepare('INSERT OR IGNORE INTO book_authors (book_id, author_id) VALUES (?, ?)');
      for (const aid of author_ids) insertBA.run(result.lastInsertRowid, aid);
    }

    res.status(201).json({ id: result.lastInsertRowid, message: 'Book added successfully' });
  } finally { db.close(); }
});

app.put('/api/books/:id', (req, res) => {
  const db = getDb();
  try {
    const { title, isbn, category_id, published_year, total_copies, description, cover_color, author_ids } = req.body;
    const existing = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Book not found' });

    const newTotal   = parseInt(total_copies) || existing.total_copies;
    const onLoan     = existing.total_copies - existing.available_copies;
    const newAvail   = Math.max(0, newTotal - onLoan);

    db.prepare(`
      UPDATE books SET title=?, isbn=?, category_id=?, published_year=?,
        total_copies=?, available_copies=?, description=?, cover_color=?
      WHERE id=?
    `).run(title, isbn || null, category_id || null, published_year || null,
           newTotal, newAvail, description || null, cover_color || existing.cover_color, req.params.id);

    if (author_ids) {
      db.prepare('DELETE FROM book_authors WHERE book_id = ?').run(req.params.id);
      const ins = db.prepare('INSERT OR IGNORE INTO book_authors (book_id, author_id) VALUES (?,?)');
      for (const aid of author_ids) ins.run(req.params.id, aid);
    }

    res.json({ message: 'Book updated' });
  } finally { db.close(); }
});

app.delete('/api/books/:id', (req, res) => {
  const db = getDb();
  try {
    const active = db.prepare('SELECT COUNT(*) as c FROM loans WHERE book_id=? AND returned_at IS NULL').get(req.params.id).c;
    if (active > 0) return res.status(400).json({ error: 'Cannot delete book with active loans' });
    db.prepare('DELETE FROM books WHERE id=?').run(req.params.id);
    res.json({ message: 'Book deleted' });
  } finally { db.close(); }
});

// ══════════════════════════════════════════════════════════════
// AUTHORS
// ══════════════════════════════════════════════════════════════
app.get('/api/authors', (req, res) => {
  const db = getDb();
  try {
    res.json(db.prepare('SELECT * FROM authors ORDER BY name').all());
  } finally { db.close(); }
});

app.post('/api/authors', (req, res) => {
  const db = getDb();
  try {
    const { name, bio, nationality } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const r = db.prepare('INSERT INTO authors (name, bio, nationality) VALUES (?,?,?)').run(name, bio || null, nationality || null);
    res.status(201).json({ id: r.lastInsertRowid });
  } finally { db.close(); }
});

// ══════════════════════════════════════════════════════════════
// CATEGORIES
// ══════════════════════════════════════════════════════════════
app.get('/api/categories', (req, res) => {
  const db = getDb();
  try {
    res.json(db.prepare('SELECT * FROM categories ORDER BY name').all());
  } finally { db.close(); }
});

app.post('/api/categories', (req, res) => {
  const db = getDb();
  try {
    const { name, description, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const r = db.prepare('INSERT INTO categories (name, description, color) VALUES (?,?,?)').run(name, description || null, color || '#6366f1');
    res.status(201).json({ id: r.lastInsertRowid });
  } finally { db.close(); }
});

// ══════════════════════════════════════════════════════════════
// MEMBERS
// ══════════════════════════════════════════════════════════════
app.get('/api/members', (req, res) => {
  const db = getDb();
  try {
    const { search, status } = req.query;
    let q = `
      SELECT m.*, COUNT(l.id) as active_loans
      FROM members m
      LEFT JOIN loans l ON l.member_id = m.id AND l.returned_at IS NULL
    `;
    const params = [];
    const cond = [];
    if (search) { cond.push('(m.name LIKE ? OR m.email LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (status) { cond.push('m.status = ?'); params.push(status); }
    if (cond.length) q += ' WHERE ' + cond.join(' AND ');
    q += ' GROUP BY m.id ORDER BY m.name';
    res.json(db.prepare(q).all(...params));
  } finally { db.close(); }
});

app.get('/api/members/:id', (req, res) => {
  const db = getDb();
  try {
    const member = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    const loans = db.prepare(`
      SELECT l.*, b.title, b.cover_color
      FROM loans l JOIN books b ON b.id = l.book_id
      WHERE l.member_id = ? ORDER BY l.issued_at DESC
    `).all(req.params.id);
    res.json({ ...member, loans });
  } finally { db.close(); }
});

app.post('/api/members', (req, res) => {
  const db = getDb();
  try {
    const { name, email, phone, address, status } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    const r = db.prepare('INSERT INTO members (name, email, phone, address, status) VALUES (?,?,?,?,?)').run(name, email, phone || null, address || null, status || 'active');
    res.status(201).json({ id: r.lastInsertRowid });
  } finally { db.close(); }
});

app.put('/api/members/:id', (req, res) => {
  const db = getDb();
  try {
    const { name, email, phone, address, status } = req.body;
    if (!db.prepare('SELECT id FROM members WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE members SET name=?,email=?,phone=?,address=?,status=?,updated_at=datetime("now") WHERE id=?').run(name, email, phone || null, address || null, status || 'active', req.params.id);
    res.json({ message: 'Member updated' });
  } finally { db.close(); }
});

app.delete('/api/members/:id', (req, res) => {
  const db = getDb();
  try {
    const active = db.prepare('SELECT COUNT(*) as c FROM loans WHERE member_id=? AND returned_at IS NULL').get(req.params.id).c;
    if (active > 0) return res.status(400).json({ error: 'Cannot delete member with active loans' });
    db.prepare('DELETE FROM members WHERE id=?').run(req.params.id);
    res.json({ message: 'Member deleted' });
  } finally { db.close(); }
});

// ══════════════════════════════════════════════════════════════
// LOANS
// ══════════════════════════════════════════════════════════════
app.get('/api/loans', (req, res) => {
  const db = getDb();
  try {
    const { status, member_id, book_id } = req.query;
    let q = `
      SELECT l.*, b.title as book_title, b.cover_color, m.name as member_name, m.email as member_email
      FROM loans l
      JOIN books b ON b.id = l.book_id
      JOIN members m ON m.id = l.member_id
    `;
    const cond = [];
    const params = [];
    if (status === 'active')   { cond.push('l.returned_at IS NULL'); }
    if (status === 'returned') { cond.push('l.returned_at IS NOT NULL'); }
    if (status === 'overdue')  { cond.push("l.returned_at IS NULL AND l.due_date < date('now')"); }
    if (member_id) { cond.push('l.member_id = ?'); params.push(member_id); }
    if (book_id)   { cond.push('l.book_id = ?'); params.push(book_id); }
    if (cond.length) q += ' WHERE ' + cond.join(' AND ');
    q += ' ORDER BY l.issued_at DESC';

    const loans = db.prepare(q).all(...params);
    // Attach computed fine
    const today = new Date();
    const enriched = loans.map(l => ({
      ...l,
      computed_fine: l.returned_at ? l.fine_amount : calcFine(l.due_date),
      days_overdue: l.returned_at ? 0 : Math.max(0, Math.floor((today - new Date(l.due_date)) / 86400000))
    }));
    res.json(enriched);
  } finally { db.close(); }
});

app.post('/api/loans', (req, res) => {
  const db = getDb();
  try {
    const { book_id, member_id, due_date, notes } = req.body;
    if (!book_id || !member_id || !due_date) return res.status(400).json({ error: 'book_id, member_id, and due_date are required' });

    const book = db.prepare('SELECT * FROM books WHERE id=?').get(book_id);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    if (book.available_copies < 1) return res.status(400).json({ error: 'No copies available' });

    const member = db.prepare("SELECT * FROM members WHERE id=? AND status='active'").get(member_id);
    if (!member) return res.status(400).json({ error: 'Member not found or not active' });

    const r = db.prepare('INSERT INTO loans (book_id, member_id, due_date, notes) VALUES (?,?,?,?)').run(book_id, member_id, due_date, notes || null);
    res.status(201).json({ id: r.lastInsertRowid, message: 'Book issued successfully' });
  } finally { db.close(); }
});

app.put('/api/loans/:id/return', (req, res) => {
  const db = getDb();
  try {
    const loan = db.prepare('SELECT * FROM loans WHERE id=?').get(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.returned_at) return res.status(400).json({ error: 'Already returned' });

    const fine = calcFine(loan.due_date);
    db.prepare("UPDATE loans SET returned_at=datetime('now'), fine_amount=? WHERE id=?").run(fine, req.params.id);
    res.json({ message: 'Book returned', fine_amount: fine });
  } finally { db.close(); }
});

app.put('/api/loans/:id/pay-fine', (req, res) => {
  const db = getDb();
  try {
    db.prepare('UPDATE loans SET fine_paid=1 WHERE id=?').run(req.params.id);
    res.json({ message: 'Fine marked as paid' });
  } finally { db.close(); }
});

// ── Health Check ─────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n📚 LibraFlow API running on http://localhost:${PORT}`);
  console.log(`   → Dashboard : GET /api/dashboard`);
  console.log(`   → Books     : GET /api/books`);
  console.log(`   → Members   : GET /api/members`);
  console.log(`   → Loans     : GET /api/loans\n`);
});
