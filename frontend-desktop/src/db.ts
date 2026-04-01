import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db: Database.Database;

export function initDb() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'nls_local.sqlite');
  
  console.log('Initializing local DB at:', dbPath);
  
  db = new Database(dbPath);
  
  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');
  
  // Schema setup
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT,
      last_seen INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(contact_id) REFERENCES contacts(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
    CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(timestamp);
  `);
  
  return db;
}

export function saveContact(id: string, name: string, status: string) {
  const stmt = db.prepare(`
    INSERT INTO contacts (id, name, status, last_seen)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      last_seen = excluded.last_seen
  `);
  stmt.run(id, name, status, Date.now());
}

export function getContacts() {
  return db.prepare('SELECT * FROM contacts ORDER BY last_seen DESC').all();
}

export function saveMessage(id: string, contactId: string, senderId: string, text: string) {
  const stmt = db.prepare(`
    INSERT INTO messages (id, contact_id, sender_id, text, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, contactId, senderId, text, Date.now());
}

export function getMessages(contactId: string, limit = 50) {
  return db.prepare(`
    SELECT * FROM messages 
    WHERE contact_id = ? 
    ORDER BY timestamp DESC 
    LIMIT ?
  `).all(contactId, limit).reverse();
}
