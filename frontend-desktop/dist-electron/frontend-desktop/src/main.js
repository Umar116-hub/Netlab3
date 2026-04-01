import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import os from 'os';
import net from 'net';
import { initDb, saveMessage, getMessages, saveContact, getContacts } from './db.js';
import { FileSender, FileReceiver } from './shared/transfer.js';
let mainWindow = null;
const fileSender = new FileSender();
const fileReceiver = new FileReceiver();
// ---- Signaling Server for "Backend OFF" Mode ----
class SignalingServer {
    server = null;
    start(port) {
        this.server = net.createServer((socket) => {
            let data = '';
            socket.on('data', (chunk) => {
                data += chunk.toString();
            });
            socket.on('end', () => {
                try {
                    const message = JSON.parse(data);
                    mainWindow?.webContents.send('p2p:receive-direct-signaling', {
                        fromIp: socket.remoteAddress,
                        payload: message
                    });
                }
                catch (err) {
                    console.error('Failed to parse direct signaling message:', err);
                }
            });
        });
        this.server.listen(port, '0.0.0.0', () => {
            console.log(`[P2P] Signaling server listening on port ${port}`);
        });
    }
}
const signalingServer = new SignalingServer();
function getLanIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const msg of interfaces[name]) {
            if (msg.family === 'IPv4' && !msg.internal) {
                return msg.address;
            }
        }
    }
    return '127.0.0.1';
}
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    if (!app.isPackaged) {
        mainWindow.loadURL('http://localhost:5174');
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
        mainWindow.webContents.openDevTools();
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
// DB IPC Handlers
ipcMain.handle('db:save-message', (_event, { id, contactId, senderId, text }) => {
    return saveMessage(id, contactId, senderId, text);
});
ipcMain.handle('db:get-messages', (_event, { contactId }) => {
    return getMessages(contactId);
});
ipcMain.handle('db:save-contact', (_event, { id, name, status }) => {
    return saveContact(id, name, status);
});
ipcMain.handle('db:get-contacts', () => {
    return getContacts();
});
// P2P IPC Handlers
ipcMain.handle('p2p:get-lan-ip', () => getLanIp());
ipcMain.handle('p2p:send-direct-signaling', async (_event, { ip, port, payload }) => {
    return new Promise((resolve, reject) => {
        const client = net.createConnection({ host: ip, port: port }, () => {
            client.write(JSON.stringify(payload));
            client.end();
            resolve(true);
        });
        client.on('error', reject);
    });
});
ipcMain.handle('p2p:select-file', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0)
        return null;
    const filePath = result.filePaths[0];
    const stats = await import('fs/promises').then(fs => fs.stat(filePath));
    return {
        path: filePath,
        name: path.basename(filePath),
        size: stats.size
    };
});
ipcMain.handle('p2p:start-sender', async (_event, { filePath }) => {
    return fileSender.start(filePath, (progress) => {
        mainWindow?.webContents.send('p2p:update-progress', progress);
    });
});
ipcMain.handle('p2p:start-receiver', async (_event, { senderIp, senderPort, fileName, totalBytes, transferId }) => {
    const userDataPath = app.getPath('downloads');
    const savePath = path.join(userDataPath, fileName);
    return fileReceiver.receive(senderIp, senderPort, savePath, totalBytes, transferId, (progress) => {
        mainWindow?.webContents.send('p2p:update-progress', progress);
    });
});
import { DiscoveryService } from './shared/discovery.js';
const discoveryService = new DiscoveryService();
app.whenReady().then(async () => {
    // Always open window first so user sees the UI regardless of service failures
    createWindow();
    try {
        initDb();
    }
    catch (e) {
        console.warn('[DB] SQLite init failed:', e);
    }
    try {
        signalingServer.start(54546);
    }
    catch (e) {
        console.warn('[P2P] Signaling server failed:', e);
    }
    // Try UDP discovery — gracefully skip if node-machine-id fails
    try {
        const machineIdModule = await import('node-machine-id').catch(() => null);
        const machineIdFn = machineIdModule?.machineIdSync ?? machineIdModule?.default?.machineIdSync;
        const myDeviceId = machineIdFn ? machineIdFn() : os.hostname();
        const myName = os.hostname();
        discoveryService.start({
            protocol_version: 1,
            device_id: myDeviceId,
            account_id: 'local',
            display_name: myName,
            p2p_tcp_port: 54546,
            identity_key_fingerprint: 'dummy',
            capabilities: 1
        }, (ip, packet) => {
            mainWindow?.webContents.send('p2p:receive-direct-signaling', {
                fromIp: ip,
                payload: {
                    type: 'presence',
                    id: packet.device_id,
                    name: packet.display_name
                }
            });
        });
    }
    catch (e) {
        console.warn('[Discovery] UDP discovery failed:', e);
    }
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
