#!/usr/bin/env python3
"""
LibraFlow E-Library Management System - REST API
Built with Python/Flask + SQLite
"""

import sqlite3
import os
import json
from datetime import datetime, date
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, '..', 'database', 'libraflow.db')
SQL_PATH = os.path.join(BASE_DIR, '..', 'database', 'schema.sql')

# ── DB Helpers ────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn

def dict_rows(rows):
    return [dict(r) for r in rows]

def calc_fine(due_date_str, returned_at=None):
    """PKR 5 per day overdue fine"""
    try:
        due = datetime.strptime(due_date_str[:10], '%Y-%m-%d').date()
        end = datetime.strptime(returned_at[:10], '%Y-%m-%d').date() if returned_at else date.today()
        days = (end - due).days
        return max(0, days * 5)
    except Exception:
        return 0

def init_db():
    """Initialize database from schema.sql"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with open(SQL_PATH, 'r') as f:
        schema = f.read()
    conn = get_db()
    # Execute statement by statement
    statements = [s.strip() for s in schema.split(';') if s.strip() and not s.strip().startswith('--')]
    for stmt in statements:
        try:
            conn.execute(stmt)
        except sqlite3.Error as e:
            if 'already exists' not in str(e) and 'UNIQUE constraint' not in str(e):
                print(f"⚠️  SQL Warning: {str(e)[:80]}")
    conn.commit()
    conn.close()
    print(f"✅ Database initialized at {DB_PATH}")

# ══════════════════════════════════════════════════════════════
# DASHBOARD
# ══════════════════════════════════════════════════════════════
@app.route('/api/dashboard')
def dashboard():
    db = get_db()
    total_books   = db.execute('SELECT COUNT(*) FROM books').fetchone()[0]
    total_members = db.execute("SELECT COUNT(*) FROM members WHERE status='active'").fetchone()[0]
    active_loans  = db.execute('SELECT COUNT(*) FROM loans WHERE returned_at IS NULL').fetchone()[0]
    overdue_loans = db.execute("SELECT COUNT(*) FROM loans WHERE returned_at IS NULL AND due_date < date('now')").fetchone()[0]

    recent_loans = dict_rows(db.execute("""
        SELECT l.id, b.title, m.name as member_name, l.issued_at, l.due_date,
               l.returned_at, b.cover_color
        FROM loans l
        JOIN books b ON b.id = l.book_id
        JOIN members m ON m.id = l.member_id
        ORDER BY l.issued_at DESC LIMIT 8
    """).fetchall())

    category_stats = dict_rows(db.execute("""
        SELECT c.name, c.color,
               COUNT(b.id) as book_count,
               SUM(COALESCE(b.total_copies - b.available_copies, 0)) as on_loan
        FROM categories c
        LEFT JOIN books b ON b.category_id = c.id
        GROUP BY c.id ORDER BY c.name
    """).fetchall())

    overdue_rows = db.execute("SELECT due_date FROM loans WHERE returned_at IS NULL AND due_date < date('now')").fetchall()
    total_fines  = sum(calc_fine(r['due_date']) for r in overdue_rows)

    db.close()
    return jsonify({
        'totalBooks': total_books,
        'totalMembers': total_members,
        'activeLoans': active_loans,
        'overdueLoans': overdue_loans,
        'totalFines': total_fines,
        'recentLoans': recent_loans,
        'categoryStats': category_stats,
    })

# ══════════════════════════════════════════════════════════════
# BOOKS
# ══════════════════════════════════════════════════════════════
@app.route('/api/books', methods=['GET'])
def get_books():
    db = get_db()
    search   = request.args.get('search', '')
    category = request.args.get('category', '')

    query = """
        SELECT b.*, c.name as category_name, c.color as category_color,
               GROUP_CONCAT(a.name, ', ') as authors
        FROM books b
        LEFT JOIN categories c ON c.id = b.category_id
        LEFT JOIN book_authors ba ON ba.book_id = b.id
        LEFT JOIN authors a ON a.id = ba.author_id
    """
    conditions, params = [], []
    if search:
        conditions.append("(b.title LIKE ? OR a.name LIKE ? OR b.isbn LIKE ?)")
        params += [f'%{search}%', f'%{search}%', f'%{search}%']
    if category:
        conditions.append("b.category_id = ?")
        params.append(category)
    if conditions:
        query += ' WHERE ' + ' AND '.join(conditions)
    query += ' GROUP BY b.id ORDER BY b.title'

    books = dict_rows(db.execute(query, params).fetchall())
    db.close()
    return jsonify(books)

@app.route('/api/books/<int:book_id>', methods=['GET'])
def get_book(book_id):
    db = get_db()
    book = db.execute("""
        SELECT b.*, c.name as category_name,
               GROUP_CONCAT(a.name, ', ') as authors
        FROM books b
        LEFT JOIN categories c ON c.id = b.category_id
        LEFT JOIN book_authors ba ON ba.book_id = b.id
        LEFT JOIN authors a ON a.id = ba.author_id
        WHERE b.id = ? GROUP BY b.id
    """, (book_id,)).fetchone()
    if not book:
        return jsonify({'error': 'Book not found'}), 404
    loans = dict_rows(db.execute("""
        SELECT l.*, m.name as member_name
        FROM loans l JOIN members m ON m.id = l.member_id
        WHERE l.book_id = ? ORDER BY l.issued_at DESC LIMIT 10
    """, (book_id,)).fetchall())
    db.close()
    return jsonify({**dict(book), 'loans': loans})

@app.route('/api/books', methods=['POST'])
def create_book():
    data = request.json or {}
    if not data.get('title'):
        return jsonify({'error': 'Title is required'}), 400
    db = get_db()
    copies = int(data.get('total_copies', 1))
    cur = db.execute("""
        INSERT INTO books (title, isbn, category_id, published_year, total_copies, available_copies, description, cover_color)
        VALUES (?,?,?,?,?,?,?,?)
    """, (data['title'], data.get('isbn'), data.get('category_id'), data.get('published_year'),
          copies, copies, data.get('description'), data.get('cover_color', '#6366f1')))
    book_id = cur.lastrowid
    for aid in data.get('author_ids', []):
        db.execute('INSERT OR IGNORE INTO book_authors (book_id, author_id) VALUES (?,?)', (book_id, aid))
    db.commit()
    db.close()
    return jsonify({'id': book_id, 'message': 'Book added successfully'}), 201

@app.route('/api/books/<int:book_id>', methods=['PUT'])
def update_book(book_id):
    db = get_db()
    existing = db.execute('SELECT * FROM books WHERE id=?', (book_id,)).fetchone()
    if not existing:
        return jsonify({'error': 'Book not found'}), 404
    data     = request.json or {}
    new_total = int(data.get('total_copies', existing['total_copies']))
    on_loan   = existing['total_copies'] - existing['available_copies']
    new_avail = max(0, new_total - on_loan)
    db.execute("""
        UPDATE books SET title=?, isbn=?, category_id=?, published_year=?,
            total_copies=?, available_copies=?, description=?, cover_color=?, updated_at=datetime('now')
        WHERE id=?
    """, (data.get('title', existing['title']), data.get('isbn'), data.get('category_id'),
          data.get('published_year'), new_total, new_avail, data.get('description'),
          data.get('cover_color', existing['cover_color']), book_id))
    if 'author_ids' in data:
        db.execute('DELETE FROM book_authors WHERE book_id=?', (book_id,))
        for aid in data['author_ids']:
            db.execute('INSERT OR IGNORE INTO book_authors (book_id, author_id) VALUES (?,?)', (book_id, aid))
    db.commit()
    db.close()
    return jsonify({'message': 'Book updated'})

@app.route('/api/books/<int:book_id>', methods=['DELETE'])
def delete_book(book_id):
    db = get_db()
    active = db.execute('SELECT COUNT(*) FROM loans WHERE book_id=? AND returned_at IS NULL', (book_id,)).fetchone()[0]
    if active > 0:
        return jsonify({'error': 'Cannot delete book with active loans'}), 400
    db.execute('DELETE FROM books WHERE id=?', (book_id,))
    db.commit()
    db.close()
    return jsonify({'message': 'Book deleted'})

# ══════════════════════════════════════════════════════════════
# AUTHORS
# ══════════════════════════════════════════════════════════════
@app.route('/api/authors', methods=['GET'])
def get_authors():
    db = get_db()
    rows = dict_rows(db.execute('SELECT * FROM authors ORDER BY name').fetchall())
    db.close()
    return jsonify(rows)

@app.route('/api/authors', methods=['POST'])
def create_author():
    data = request.json or {}
    if not data.get('name'):
        return jsonify({'error': 'Name is required'}), 400
    db = get_db()
    cur = db.execute('INSERT INTO authors (name, bio, nationality) VALUES (?,?,?)',
                     (data['name'], data.get('bio'), data.get('nationality')))
    db.commit()
    db.close()
    return jsonify({'id': cur.lastrowid}), 201

# ══════════════════════════════════════════════════════════════
# CATEGORIES
# ══════════════════════════════════════════════════════════════
@app.route('/api/categories', methods=['GET'])
def get_categories():
    db = get_db()
    rows = dict_rows(db.execute('SELECT * FROM categories ORDER BY name').fetchall())
    db.close()
    return jsonify(rows)

@app.route('/api/categories', methods=['POST'])
def create_category():
    data = request.json or {}
    if not data.get('name'):
        return jsonify({'error': 'Name is required'}), 400
    db = get_db()
    cur = db.execute('INSERT INTO categories (name, description, color) VALUES (?,?,?)',
                     (data['name'], data.get('description'), data.get('color', '#6366f1')))
    db.commit()
    db.close()
    return jsonify({'id': cur.lastrowid}), 201

# ══════════════════════════════════════════════════════════════
# MEMBERS
# ══════════════════════════════════════════════════════════════
@app.route('/api/members', methods=['GET'])
def get_members():
    db = get_db()
    search = request.args.get('search', '')
    status = request.args.get('status', '')
    q = """
        SELECT m.*, COUNT(l.id) as active_loans
        FROM members m
        LEFT JOIN loans l ON l.member_id = m.id AND l.returned_at IS NULL
    """
    conditions, params = [], []
    if search:
        conditions.append('(m.name LIKE ? OR m.email LIKE ?)')
        params += [f'%{search}%', f'%{search}%']
    if status:
        conditions.append('m.status = ?')
        params.append(status)
    if conditions:
        q += ' WHERE ' + ' AND '.join(conditions)
    q += ' GROUP BY m.id ORDER BY m.name'
    rows = dict_rows(db.execute(q, params).fetchall())
    db.close()
    return jsonify(rows)

@app.route('/api/members/<int:member_id>', methods=['GET'])
def get_member(member_id):
    db = get_db()
    member = db.execute('SELECT * FROM members WHERE id=?', (member_id,)).fetchone()
    if not member:
        return jsonify({'error': 'Not found'}), 404
    loans = dict_rows(db.execute("""
        SELECT l.*, b.title, b.cover_color FROM loans l
        JOIN books b ON b.id = l.book_id WHERE l.member_id=? ORDER BY l.issued_at DESC
    """, (member_id,)).fetchall())
    db.close()
    return jsonify({**dict(member), 'loans': loans})

@app.route('/api/members', methods=['POST'])
def create_member():
    data = request.json or {}
    if not data.get('name') or not data.get('email'):
        return jsonify({'error': 'Name and email are required'}), 400
    db = get_db()
    try:
        cur = db.execute('INSERT INTO members (name, email, phone, address, status) VALUES (?,?,?,?,?)',
                         (data['name'], data['email'], data.get('phone'), data.get('address'), data.get('status', 'active')))
        db.commit()
        db.close()
        return jsonify({'id': cur.lastrowid}), 201
    except sqlite3.IntegrityError:
        db.close()
        return jsonify({'error': 'Email already exists'}), 400

@app.route('/api/members/<int:member_id>', methods=['PUT'])
def update_member(member_id):
    db = get_db()
    if not db.execute('SELECT id FROM members WHERE id=?', (member_id,)).fetchone():
        return jsonify({'error': 'Not found'}), 404
    data = request.json or {}
    db.execute("UPDATE members SET name=?,email=?,phone=?,address=?,status=?,updated_at=datetime('now') WHERE id=?",
               (data.get('name'), data.get('email'), data.get('phone'), data.get('address'), data.get('status', 'active'), member_id))
    db.commit()
    db.close()
    return jsonify({'message': 'Member updated'})

@app.route('/api/members/<int:member_id>', methods=['DELETE'])
def delete_member(member_id):
    db = get_db()
    active = db.execute('SELECT COUNT(*) FROM loans WHERE member_id=? AND returned_at IS NULL', (member_id,)).fetchone()[0]
    if active > 0:
        return jsonify({'error': 'Cannot delete member with active loans'}), 400
    db.execute('DELETE FROM members WHERE id=?', (member_id,))
    db.commit()
    db.close()
    return jsonify({'message': 'Member deleted'})

# ══════════════════════════════════════════════════════════════
# LOANS
# ══════════════════════════════════════════════════════════════
@app.route('/api/loans', methods=['GET'])
def get_loans():
    db = get_db()
    status    = request.args.get('status', '')
    member_id = request.args.get('member_id', '')
    book_id   = request.args.get('book_id', '')

    q = """
        SELECT l.*, b.title as book_title, b.cover_color, m.name as member_name, m.email as member_email
        FROM loans l
        JOIN books b ON b.id = l.book_id
        JOIN members m ON m.id = l.member_id
    """
    conditions, params = [], []
    if status == 'active':   conditions.append('l.returned_at IS NULL')
    if status == 'returned': conditions.append('l.returned_at IS NOT NULL')
    if status == 'overdue':  conditions.append("l.returned_at IS NULL AND l.due_date < date('now')")
    if member_id: conditions.append('l.member_id = ?'); params.append(member_id)
    if book_id:   conditions.append('l.book_id = ?');   params.append(book_id)
    if conditions:
        q += ' WHERE ' + ' AND '.join(conditions)
    q += ' ORDER BY l.issued_at DESC'

    loans = dict_rows(db.execute(q, params).fetchall())
    today = date.today()
    for l in loans:
        l['computed_fine']  = calc_fine(l['due_date'], l['returned_at'])
        due = datetime.strptime(l['due_date'][:10], '%Y-%m-%d').date()
        l['days_overdue']   = max(0, (today - due).days) if not l['returned_at'] else 0
    db.close()
    return jsonify(loans)

@app.route('/api/loans', methods=['POST'])
def create_loan():
    data = request.json or {}
    if not all([data.get('book_id'), data.get('member_id'), data.get('due_date')]):
        return jsonify({'error': 'book_id, member_id, and due_date are required'}), 400
    db = get_db()
    book = db.execute('SELECT * FROM books WHERE id=?', (data['book_id'],)).fetchone()
    if not book:
        return jsonify({'error': 'Book not found'}), 404
    if book['available_copies'] < 1:
        return jsonify({'error': 'No copies available'}), 400
    member = db.execute("SELECT * FROM members WHERE id=? AND status='active'", (data['member_id'],)).fetchone()
    if not member:
        return jsonify({'error': 'Member not found or not active'}), 400
    cur = db.execute('INSERT INTO loans (book_id, member_id, due_date, notes) VALUES (?,?,?,?)',
                     (data['book_id'], data['member_id'], data['due_date'], data.get('notes')))
    db.commit()
    db.close()
    return jsonify({'id': cur.lastrowid, 'message': 'Book issued successfully'}), 201

@app.route('/api/loans/<int:loan_id>/return', methods=['PUT'])
def return_loan(loan_id):
    db = get_db()
    loan = db.execute('SELECT * FROM loans WHERE id=?', (loan_id,)).fetchone()
    if not loan:
        return jsonify({'error': 'Loan not found'}), 404
    if loan['returned_at']:
        return jsonify({'error': 'Already returned'}), 400
    fine = calc_fine(loan['due_date'])
    db.execute("UPDATE loans SET returned_at=datetime('now'), fine_amount=? WHERE id=?", (fine, loan_id))
    db.commit()
    db.close()
    return jsonify({'message': 'Book returned successfully', 'fine_amount': fine})

@app.route('/api/loans/<int:loan_id>/pay-fine', methods=['PUT'])
def pay_fine(loan_id):
    db = get_db()
    db.execute('UPDATE loans SET fine_paid=1 WHERE id=?', (loan_id,))
    db.commit()
    db.close()
    return jsonify({'message': 'Fine marked as paid'})

# ── Health ────────────────────────────────────────────────────
@app.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'time': datetime.now().isoformat()})

# ── Bootstrap ─────────────────────────────────────────────────
if __name__ == '__main__':
    if not os.path.exists(DB_PATH):
        init_db()
    else:
        print(f"✅ Using existing database at {DB_PATH}")
    print("\n📚 LibraFlow API starting on http://localhost:3001\n")
    app.run(host='0.0.0.0', port=3001, debug=False)
