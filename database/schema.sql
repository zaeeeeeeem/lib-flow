-- ============================================================
-- LibraFlow E-Library Management System
-- Database Schema
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ── Categories ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT,
  color       TEXT    DEFAULT '#6366f1',
  created_at  TEXT    DEFAULT (datetime('now'))
);

-- ── Authors ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS authors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  bio        TEXT,
  nationality TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── Books ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS books (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT    NOT NULL,
  isbn            TEXT    UNIQUE,
  category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  published_year  INTEGER,
  total_copies    INTEGER NOT NULL DEFAULT 1,
  available_copies INTEGER NOT NULL DEFAULT 1,
  description     TEXT,
  cover_color     TEXT    DEFAULT '#6366f1',
  created_at      TEXT    DEFAULT (datetime('now')),
  updated_at      TEXT    DEFAULT (datetime('now'))
);

-- ── Book ↔ Author (many-to-many) ────────────────────────────
CREATE TABLE IF NOT EXISTS book_authors (
  book_id   INTEGER NOT NULL REFERENCES books(id)   ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, author_id)
);

-- ── Members ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  email      TEXT    NOT NULL UNIQUE,
  phone      TEXT,
  address    TEXT,
  status     TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','expired')),
  joined_at  TEXT    DEFAULT (datetime('now')),
  updated_at TEXT    DEFAULT (datetime('now'))
);

-- ── Loans ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id      INTEGER NOT NULL REFERENCES books(id)   ON DELETE RESTRICT,
  member_id    INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  issued_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  due_date     TEXT    NOT NULL,
  returned_at  TEXT,
  fine_amount  REAL    NOT NULL DEFAULT 0,
  fine_paid    INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TEXT    DEFAULT (datetime('now'))
);

-- ── Triggers ─────────────────────────────────────────────────
-- Decrement available copies on loan
CREATE TRIGGER IF NOT EXISTS after_loan_insert
AFTER INSERT ON loans
BEGIN
  UPDATE books SET available_copies = available_copies - 1,
                   updated_at = datetime('now')
  WHERE id = NEW.book_id;
END;

-- Increment available copies on return
CREATE TRIGGER IF NOT EXISTS after_loan_return
AFTER UPDATE OF returned_at ON loans
WHEN NEW.returned_at IS NOT NULL AND OLD.returned_at IS NULL
BEGIN
  UPDATE books SET available_copies = available_copies + 1,
                   updated_at = datetime('now')
  WHERE id = NEW.book_id;
END;

-- Auto-update updated_at on books
CREATE TRIGGER IF NOT EXISTS books_updated_at
AFTER UPDATE ON books
BEGIN
  UPDATE books SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ── Seed Data ────────────────────────────────────────────────
INSERT OR IGNORE INTO categories (name, description, color) VALUES
  ('Fiction',        'Novels, short stories, and imaginative literature', '#6366f1'),
  ('Science',        'Physics, chemistry, biology, and natural sciences',  '#06b6d4'),
  ('Technology',     'Computing, programming, and engineering',            '#8b5cf6'),
  ('History',        'World history, biographies, and historical accounts','#f59e0b'),
  ('Philosophy',     'Ethics, logic, metaphysics, and epistemology',       '#10b981'),
  ('Self-Help',      'Personal development and motivation',                '#f43f5e'),
  ('Mathematics',    'Pure and applied mathematics',                       '#3b82f6'),
  ('Literature',     'Classic and contemporary literary works',            '#ec4899');

INSERT OR IGNORE INTO authors (name, bio, nationality) VALUES
  ('George Orwell',      'English novelist known for dystopian fiction',        'British'),
  ('Frank Herbert',      'Author of the Dune series',                          'American'),
  ('J.K. Rowling',       'Author of the Harry Potter series',                  'British'),
  ('Yuval Noah Harari',  'Historian and author of Sapiens',                    'Israeli'),
  ('Robert C. Martin',   'Software engineer and author, "Uncle Bob"',          'American'),
  ('Fyodor Dostoevsky',  'Russian novelist and philosopher',                   'Russian'),
  ('Carl Sagan',         'Astronomer, cosmologist, and science communicator',  'American'),
  ('Stephen Hawking',    'Theoretical physicist and cosmologist',              'British');

INSERT OR IGNORE INTO books (title, isbn, category_id, published_year, total_copies, available_copies, description, cover_color) VALUES
  ('1984',                        '978-0451524935', 1, 1949, 5, 5, 'A dystopian novel set in a totalitarian society.',          '#6366f1'),
  ('Dune',                        '978-0441013593', 1, 1965, 3, 3, 'Epic science fiction about politics and ecology.',           '#f59e0b'),
  ('Harry Potter & the Sorcerer', '978-0439708180', 8, 1997, 6, 6, 'The beginning of a young wizard''s journey.',               '#ec4899'),
  ('Sapiens',                     '978-0062316097', 4, 2011, 4, 4, 'Brief history of humankind.',                               '#10b981'),
  ('Clean Code',                  '978-0132350884', 3, 2008, 3, 3, 'Handbook of agile software craftsmanship.',                 '#8b5cf6'),
  ('Crime and Punishment',        '978-0486415871', 8, 1866, 2, 2, 'Psychological novel about guilt and redemption.',           '#f43f5e'),
  ('Cosmos',                      '978-0345539434', 2, 1980, 4, 4, 'A personal voyage through space and time.',                 '#06b6d4'),
  ('A Brief History of Time',     '978-0553380163', 2, 1988, 3, 3, 'From the Big Bang to black holes.',                        '#3b82f6');

INSERT OR IGNORE INTO book_authors (book_id, author_id) VALUES
  (1,1),(2,2),(3,3),(4,4),(5,5),(6,6),(7,7),(8,8);

INSERT OR IGNORE INTO members (name, email, phone, address, status) VALUES
  ('Ahmed Raza',      'ahmed.raza@email.com',    '+92-300-1234567', 'Gulberg III, Lahore',     'active'),
  ('Sara Khan',       'sara.khan@email.com',     '+92-321-2345678', 'DHA Phase 5, Lahore',     'active'),
  ('Usman Ali',       'usman.ali@email.com',     '+92-333-3456789', 'Model Town, Lahore',      'active'),
  ('Fatima Malik',    'fatima.malik@email.com',  '+92-345-4567890', 'Johar Town, Lahore',      'active'),
  ('Bilal Sheikh',    'bilal.sheikh@email.com',  '+92-311-5678901', 'Bahria Town, Lahore',     'suspended'),
  ('Zainab Hussain',  'zainab.h@email.com',      '+92-322-6789012', 'Garden Town, Lahore',    'active');

-- Active loans (some overdue)
INSERT OR IGNORE INTO loans (book_id, member_id, issued_at, due_date, fine_amount) VALUES
  (1, 1, datetime('now','-20 days'), date('now','-6 days'),  0),
  (2, 2, datetime('now','-10 days'), date('now','4 days'),   0),
  (5, 3, datetime('now','-25 days'), date('now','-11 days'), 0),
  (7, 4, datetime('now','-5 days'),  date('now','9 days'),   0),
  (3, 6, datetime('now','-30 days'), date('now','-16 days'), 0);
