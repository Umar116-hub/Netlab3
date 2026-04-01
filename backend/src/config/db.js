import Database from 'better-sqlite3';
import path from 'path';
// For development, we store it at the root. In production, this can point to AppData/Config folders.
const dbPath = path.join(__dirname, '../../../nls.sqlite');
let dbInstance = null;
export const getDb = () => {
    if (!dbInstance) {
        dbInstance = new Database(dbPath, {
        // verbose: console.log 
        });
        // Use Write-Ahead Logging for better concurrent performance
        dbInstance.pragma('journal_mode = WAL');
    }
    return dbInstance;
};
export const closeDb = () => {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
};
//# sourceMappingURL=db.js.map