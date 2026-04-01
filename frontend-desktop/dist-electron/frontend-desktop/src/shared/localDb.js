import Database from 'better-sqlite3';
import path from 'path';
let dbInstance = null;
// Electron handles storage natively in AppData, but for v1 Dev we'll keep it adjacent
export const getLocalDb = () => {
    if (!dbInstance) {
        const dbPath = path.join(__dirname, '../../local_client_nls.sqlite');
        dbInstance = new Database(dbPath);
        dbInstance.pragma('journal_mode = WAL');
        // Auto-migrate schema on bootstrap
        initLocalSchema(dbInstance);
    }
    return dbInstance;
};
const initLocalSchema = (db) => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS local_conversations (
      id TEXT PRIMARY KEY,
      type TEXT,
      created_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS local_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      sender_account_id TEXT,
      sender_device_id TEXT,
      server_seq INTEGER,
      plaintext_blob TEXT, -- Decrypted content cache!
      metadata_json TEXT,
      created_at DATETIME,
      status TEXT DEFAULT 'sent'
    );

    CREATE TABLE IF NOT EXISTS encrypted_key_bundle_cache (
      id TEXT PRIMARY KEY,
      bundled_json TEXT
    );

    CREATE TABLE IF NOT EXISTS device_identity (
      device_id TEXT PRIMARY KEY,
      public_fingerprint TEXT
    );
  `);
};
