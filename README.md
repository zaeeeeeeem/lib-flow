# 📚 LibraFlow — E-Library Management System

A full-stack library management system with a Python/Flask REST API, SQLite database, and a polished dark-themed frontend.

## Features

- **Books** — Full CRUD: add, edit, delete, search by title/author/ISBN
- **Members** — Registration, status management (active/suspended/expired)
- **Loans** — Issue & return books, automatic inventory tracking
- **Overdue Detection** — Auto-flagged with fine calculation (₨5/day)
- **Authors & Categories** — Reference data management
- **Dashboard** — Live stats, recent activity, category breakdown

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3 + Flask + Flask-CORS |
| Database | SQLite (via Python `sqlite3`) |
| Frontend | Vanilla HTML/CSS/JS (zero dependencies) |

## Project Structure

```
libraflow/
├── backend/
│   ├── app.py          # Flask REST API (all routes)
│   └── scripts/
│       └── initDb.js   # DB init reference
├── database/
│   ├── schema.sql      # Full schema + seed data
│   └── libraflow.db    # SQLite database (auto-created)
└── frontend/
    └── index.html      # Complete single-file frontend
```

## Quick Start

### 1. Install backend dependencies
```bash
pip install flask flask-cors
```

### 2. Start the API server
```bash
cd backend
python3 app.py
# → API running on http://localhost:3001
```

### 3. Open the frontend
Open `frontend/index.html` in your browser directly (no build step needed).

> The frontend auto-detects if the API is offline and falls back to demo/mock data.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard` | Stats, recent loans, category breakdown |
| GET/POST | `/api/books` | List / create books |
| GET/PUT/DELETE | `/api/books/:id` | Get / update / delete a book |
| GET/POST | `/api/members` | List / create members |
| GET/PUT/DELETE | `/api/members/:id` | Get / update / delete a member |
| GET/POST | `/api/loans` | List loans (filter: active/overdue/returned) |
| PUT | `/api/loans/:id/return` | Return a book |
| GET/POST | `/api/authors` | Authors |
| GET/POST | `/api/categories` | Categories |

## Database Schema

```
categories ──< books >── book_authors >── authors
                │
                └──< loans >── members
```

- **One-to-many**: One category → many books; One member → many loans
- **Many-to-many**: Books ↔ Authors (via `book_authors`)
- **Triggers**: Auto-update `available_copies` on loan insert/return

## Fine Calculation

Overdue fine = **₨5 × days overdue**

Calculated dynamically; saved to DB on return.

## License

MIT
