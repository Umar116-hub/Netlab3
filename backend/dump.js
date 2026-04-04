const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('../nls.sqlite', { readonly: true });
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
let output = '# Database Dump\n\n';

for (const {name} of tables) {
  output += '## Table: ' + name + '\n';
  const rows = db.prepare('SELECT * FROM ' + name).all();
  if (rows.length === 0) {
    output += '*(Empty)*\n\n';
  } else {
    // Format as markdown table
    const keys = Object.keys(rows[0]);
    output += '| ' + keys.join(' | ') + ' |\n';
    output += '| ' + keys.map(() => '---').join(' | ') + ' |\n';
    for (const row of rows) {
      output += '| ' + keys.map(k => {
          let val = row[k];
          if (Buffer.isBuffer(val)) {
             return '<BINARY BLOB>';
          }
          if (val === null) return 'NULL';
          return String(val).replace(/\|/g, '\\|').replace(/\n/g, ' ');
      }).join(' | ') + ' |\n';
    }
    output += '\n\n';
  }
}

// Write to the artifacts directory so antigravity detects it
const targetDir = 'C:/Users/Admin/.gemini/antigravity/brain/824a7fac-3723-4c6e-89d1-7814efa41244';
fs.writeFileSync(`${targetDir}/database_dump.md`, output);
console.log('Database dumped to ' + targetDir);
