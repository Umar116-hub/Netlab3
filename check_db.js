const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'backend/netlab.db');
const db = new Database(dbPath);

console.log('--- Database File Transfer Status Dump ---');
const messages = db.prepare("SELECT id, sender_account_id, metadata_json FROM messages WHERE metadata_json LIKE '%file_info%'").all();

messages.forEach(m => {
  try {
    const meta = JSON.parse(m.metadata_json);
    const fi = meta.file_info || meta;
    console.log(`ID: ${m.id} | Sender: ${m.sender_account_id} | Name: ${fi.name} | Status: ${fi.status} | TID: ${fi.transfer_id}`);
  } catch (e) {
    console.log(`ID: ${m.id} | Failed to parse: ${m.metadata_json}`);
  }
});
console.log('--- End of Dump ---');
