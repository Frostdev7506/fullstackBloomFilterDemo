const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`).run();

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
}

function getAllEmails() {
  return db.prepare('SELECT email FROM users').all().map(r => r.email);
}

function findUserByEmail(email) {
  return db.prepare('SELECT id, email, name, created_at FROM users WHERE email = ?').get(email);
}

function createUser({ email, name }) {
  const normalized = normalizeEmail(email);
  const now = new Date().toISOString();
  const stmt = db.prepare('INSERT INTO users (email, name, created_at) VALUES (?, ?, ?)');
  const info = stmt.run(normalized, name, now);
  return { id: info.lastInsertRowid, email: normalized, name, created_at: now };
}

function seedIfEmpty() {
  if (countUsers() === 0) {
    const samples = [
      { name: 'Ada Lovelace', email: 'ada@example.com' },
      { name: 'Linus Torvalds', email: 'linus@example.com' },
      { name: 'Grace Hopper', email: 'grace@example.com' },
      { name: 'Satoshi Nakamoto', email: 'satoshi@example.com' },
      { name: 'Neeraj Butola', email: 'neeraj@example.com' },
      { name: 'Alan Turing', email: 'alan@example.com' }

    ];
    const insert = db.prepare('INSERT INTO users (email, name, created_at) VALUES (?, ?, ?)');
    const now = new Date().toISOString();
    const tx = db.transaction((rows) => {
      for (const r of rows) insert.run(normalizeEmail(r.email), r.name, now);
    });
    tx(samples);
  }
}

module.exports = {
  db,
  normalizeEmail,
  countUsers,
  getAllEmails,
  findUserByEmail,
  createUser,
  seedIfEmpty
};
