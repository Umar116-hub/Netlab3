import Database from 'better-sqlite3';
import path from 'path';
const dbPath = path.join(__dirname, '../../../nls.sqlite');
const db = new Database(dbPath, { verbose: console.log });
console.log(`Connected to SQLite database at ${dbPath}`);
// 10.1 accounts
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disabled_at DATETIME NULL,
    deleted_at DATETIME NULL
  );
`);
// 10.2 devices
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    account_id TEXT REFERENCES accounts(id),
    device_id TEXT UNIQUE NOT NULL,
    identity_key_public BLOB NOT NULL,
    identity_key_fingerprint TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NULL,
    deleted_at DATETIME NULL
  );
`);
// 10.3 sessions
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    account_id TEXT REFERENCES accounts(id),
    device_id TEXT REFERENCES devices(id),
    token_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`);
// 10.4 prekeys
db.exec(`
  CREATE TABLE IF NOT EXISTS prekeys (
    id TEXT PRIMARY KEY,
    device_id TEXT REFERENCES devices(id),
    type TEXT CHECK (type IN ('SPK', 'OPK')),
    public_key BLOB NOT NULL,
    signature BLOB NULL,
    consumed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL
  );
  CREATE INDEX IF NOT EXISTS idx_prekeys_device_id ON prekeys(device_id);
  CREATE INDEX IF NOT EXISTS idx_prekeys_type ON prekeys(type);
`);
// 10.5 conversations
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT CHECK (type IN ('dm', 'group')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL
  );
`);
// 10.6 conversation_members
db.exec(`
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT REFERENCES conversations(id),
    account_id TEXT REFERENCES accounts(id),
    role TEXT CHECK (role IN ('creator', 'admin', 'member')),
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at DATETIME NULL,
    deleted_at DATETIME NULL,
    PRIMARY KEY (conversation_id, account_id)
  );
`);
// 10.7 messages
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT REFERENCES conversations(id),
    sender_account_id TEXT REFERENCES accounts(id),
    sender_device_id TEXT REFERENCES devices(id),
    server_seq INTEGER NOT NULL,
    ciphertext_blob BLOB NOT NULL,
    ciphertext_type TEXT,
    metadata_json TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_server_seq ON messages(conversation_id, server_seq);
  CREATE INDEX IF NOT EXISTS idx_messages_sender_account_id ON messages(sender_account_id);
`);
// 10.8 delivery_receipts
db.exec(`
  CREATE TABLE IF NOT EXISTS delivery_receipts (
    message_id TEXT REFERENCES messages(id),
    recipient_account_id TEXT REFERENCES accounts(id),
    recipient_device_id TEXT REFERENCES devices(id),
    status TEXT CHECK (status IN ('delivered', 'expired')),
    acked_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, recipient_device_id)
  );
`);
// 10.9 file_transfers
db.exec(`
  CREATE TABLE IF NOT EXISTS file_transfers (
    id TEXT PRIMARY KEY,
    conversation_id TEXT REFERENCES conversations(id),
    sender_account_id TEXT REFERENCES accounts(id),
    receiver_scope TEXT,
    file_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    transport TEXT CHECK (transport IN ('tcp', 'webrtc', 'relay')),
    final_hash_sha256 TEXT NOT NULL,
    status TEXT CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NULL,
    deleted_at DATETIME NULL
  );
  CREATE INDEX IF NOT EXISTS idx_file_transfers_conversation_id ON file_transfers(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_file_transfers_status ON file_transfers(status);
`);
// 10.10 file_chunks_relay
db.exec(`
  CREATE TABLE IF NOT EXISTS file_chunks_relay (
    transfer_id TEXT REFERENCES file_transfers(id),
    chunk_index INTEGER NOT NULL,
    ciphertext_chunk BLOB NOT NULL,
    chunk_hash_sha256 TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,
    PRIMARY KEY (transfer_id, chunk_index)
  );
`);
console.log('SQLite database tables successfully created!');
db.close();
//# sourceMappingURL=initDb.js.map