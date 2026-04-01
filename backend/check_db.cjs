const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../nls.sqlite');
const db = new Database(dbPath);

console.log('--- Sessions ---');
const sessions = db.prepare('SELECT * FROM sessions').all();
console.log(JSON.stringify(sessions, null, 2));

console.log('--- Devices ---');
const devices = db.prepare('SELECT * FROM devices').all();
console.log(JSON.stringify(devices, null, 2));

db.close();
