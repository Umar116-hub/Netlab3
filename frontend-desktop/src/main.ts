import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import os from 'os';
import net from 'net';
import { FileSender, FileReceiver } from './shared/transfer.js';

let mainWindow: BrowserWindow | null = null;
const fileSender = new FileSender();
const fileReceiver = new FileReceiver();

let rendererReady = false;
const messageQueue: any[] = [];

function sendToRenderer(channel: string, data: any) {
  if (rendererReady && mainWindow) {
    mainWindow.webContents.send(channel, data);
  } else {
    messageQueue.push({ channel, data });
  }
}

// ---- Signaling Server for "Backend OFF" Mode ----
class SignalingServer {
  private server: net.Server | null = null;

  start(port: number) {
    this.server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
      });
      
      socket.on('error', (err) => {
        console.error('[P2P] Signaling socket error:', err);
      });

      socket.on('end', () => {
        if (buffer.length === 0) return;
        try {
          const messageStr = buffer.toString('utf8');
          const message = JSON.parse(messageStr);
          const rawIp = socket.remoteAddress;
          const fromIp = rawIp?.includes('::') ? rawIp.split(':').pop() : rawIp;
          
          console.log('[P2P] Received signaling from', fromIp, 'Type:', message.type);
          
          sendToRenderer('p2p:receive-direct-signaling', {
            fromIp: fromIp || '127.0.0.1', 
            payload: message
          });
        } catch (err) {
          console.error('[P2P] Failed to parse signaling message:', err, 'Raw Data:', buffer.toString());
        } finally {
          socket.destroy();
        }
      });
    });

    this.server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[P2P] Port ${port} in use, P2P signaling might fail.`);
      } else {
        console.error('[P2P] Signaling server error:', err);
      }
    });

    this.server.listen(port, '0.0.0.0', () => {
      console.log(`[P2P] Signaling server listening on port ${port}`);
    });
  }
}

const signalingServer = new SignalingServer();

function getLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const msg of interfaces[name]!) {
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
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });
}

// 0. GLOBAL HANDLERS: Register these EARLIEST before app is even "ready"
// This solves the 'No handler registered' error for fast-loading windows
ipcMain.handle('p2p:get-my-info', async () => {
  try {
    const machineIdModule = await import('node-machine-id').catch(() => null);
    const machineIdFn = machineIdModule?.machineIdSync ?? machineIdModule?.default?.machineIdSync;
    const myId = machineIdFn ? machineIdFn() : os.hostname();
    return { id: myId, name: os.hostname() };
  } catch (e) {
    return { id: os.hostname(), name: os.hostname() };
  }
});

ipcMain.handle('p2p:get-lan-ip', () => getLanIp());

ipcMain.handle('p2p:renderer-ready', () => {
  rendererReady = true;
  console.log('[P2P] Renderer ready, flushing', messageQueue.length, 'messages');
  while (messageQueue.length > 0 && mainWindow) {
    const { channel, data } = messageQueue.shift();
    mainWindow.webContents.send(channel, data);
  }
});

// STARTUP SEQUENCE: Robust against DB failures
app.whenReady().then(async () => {
  // These can stay inside ready as they are only used later
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
    const result = await dialog.showOpenDialog({ properties: ['openFile'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const stats = await import('fs/promises').then(fs => fs.stat(filePath));
    return { path: filePath, name: path.basename(filePath), size: stats.size };
  });

  ipcMain.on('p2p:get-save-path', async (event, fileName) => {
    const result = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('downloads'), fileName),
      title: 'Save Received File'
    });
    event.reply('p2p:save-path-selected', result.canceled ? null : result.filePath);
  });

  ipcMain.handle('p2p:start-sender', async (_event, { filePath, transferId }) => {
    return fileSender.start(filePath, transferId, (p) => sendToRenderer('p2p:update-progress', p));
  });

  ipcMain.handle('p2p:start-receiver', async (_event, { senderIp, senderPort, savePath, totalBytes, transferId }) => {
    return fileReceiver.receive(senderIp, senderPort, savePath, totalBytes, transferId, (p) => sendToRenderer('p2p:update-progress', p));
  });

  ipcMain.handle('p2p:pause-transfer', () => {
    fileSender.pause();
    fileReceiver.pause();
    return true;
  });

  ipcMain.handle('p2p:cancel-transfer', () => {
    fileSender.cancel();
    fileReceiver.cancel();
    return true;
  });

  // 1. CREATE WINDOW
  createWindow();

  // 2. LAZY LOAD DB & START SERVICES
  try {
     const dbModule = await import('./db.js').catch(() => null);
     if (dbModule) {
        dbModule.initDb();
        ipcMain.handle('db:save-message', (_e, { id, contactId, senderId, text }) => dbModule.saveMessage(id, contactId, senderId, text));
        ipcMain.handle('db:get-messages', (_e, { contactId }) => dbModule.getMessages(contactId));
        ipcMain.handle('db:save-contact', (_e, { id, name, status }) => dbModule.saveContact(id, name, status));
        ipcMain.handle('db:get-contacts', () => dbModule.getContacts());
     }
  } catch (e) {
     console.warn('[DB] SQLite failed to load (Node v24 issues?). App will run in Memory-Only Mode.', e);
  }

  try { signalingServer.start(54546); } catch (e) { console.warn('[P2P] Signaling server failed:', e); }

  try {
    const { DiscoveryService } = await import('./shared/discovery.js');
    const discoveryService = new DiscoveryService();
    const machineIdModule = await import('node-machine-id').catch(() => null);
    const machineIdFn = machineIdModule?.machineIdSync ?? machineIdModule?.default?.machineIdSync;
    const myId = machineIdFn ? machineIdFn() : os.hostname();
    
    discoveryService.start({
      protocol_version: 1,
      device_id: myId,
      account_id: 'local',
      display_name: os.hostname(),
      p2p_tcp_port: 54546,
      identity_key_fingerprint: 'dummy',
      capabilities: 1
    }, (ip, packet) => {
      sendToRenderer('p2p:receive-direct-signaling', {
        fromIp: ip,
        payload: { type: 'presence', id: packet.device_id, name: packet.display_name }
      });
    });
  } catch (e) { console.warn('[Discovery] UDP discovery failed:', e); }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
