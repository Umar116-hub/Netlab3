import net from 'net';
import fs from 'fs';

export interface TransferProgress {
  transferId: string;
  bytesTransferred: number;
  totalBytes: number;
  status: 'pending' | 'active' | 'completed' | 'error' | 'paused' | 'cancelled';
  speed?: number; // bytes per second
  timeRemaining?: number; // estimated seconds
  error?: string;
}

export class FileSender {
  private server: net.Server | null = null;
  private currentSocket: net.Socket | null = null;
  private currentReadStream: fs.ReadStream | null = null;
  private bytesSent = 0;
  private totalBytes = 0;
  private transferId = '';
  private filePath = '';
  private startTime = 0;
  private lastReportTime = 0;
  private lastReportBytes = 0;

  start(filePath: string, onProgress: (p: TransferProgress) => void): Promise<{ port: number }> {
    this.filePath = filePath;
    const stats = fs.statSync(filePath);
    this.totalBytes = stats.size;
    this.transferId = `tx-${Math.random().toString(36).substring(7)}`;
    this.bytesSent = 0;
    this.startTime = Date.now();
    this.lastReportTime = this.startTime;
    this.lastReportBytes = 0;

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        console.log('[Transfer] Receiver connected');
        this.currentSocket = socket;
        
        // Start from where we left off
        this.currentReadStream = fs.createReadStream(this.filePath, { start: this.bytesSent });

        this.currentReadStream.on('data', (chunk) => {
          this.bytesSent += chunk.length;
          
          const now = Date.now();
          if (now - this.lastReportTime >= 800) { // Throttle updates for UI stability
            const speed = (this.bytesSent - this.lastReportBytes) / ((now - this.lastReportTime) / 1000);
            const remaining = (this.totalBytes - this.bytesSent) / speed;
            
            onProgress({
              transferId: this.transferId,
              bytesTransferred: this.bytesSent,
              totalBytes: this.totalBytes,
              status: 'active',
              speed,
              timeRemaining: isFinite(remaining) ? remaining : -1
            });
            
            this.lastReportTime = now;
            this.lastReportBytes = this.bytesSent;
          }
        });

        this.currentReadStream.on('end', () => {
          if (this.bytesSent >= this.totalBytes) {
            onProgress({
              transferId: this.transferId,
              bytesTransferred: this.totalBytes,
              totalBytes: this.totalBytes,
              status: 'completed'
            });
            this.stop();
          }
        });

        this.currentReadStream.on('error', (err) => {
          onProgress({
            transferId: this.transferId,
            bytesTransferred: this.bytesSent,
            totalBytes: this.totalBytes,
            status: 'error',
            error: err.message
          });
          this.stop();
        });

        this.currentReadStream.pipe(socket);
        
        socket.on('error', (err) => {
          console.error('[Transfer] Socket error:', err);
          this.pause(); // Auto-pause on connection loss
        });
      });

      this.server.listen(0, '0.0.0.0', () => {
        const address = this.server?.address();
        if (address && typeof address !== 'string') {
          resolve({ port: address.port });
        } else {
          reject(new Error('Failed to get server port'));
        }
      });
    });
  }

  pause() {
    if (this.currentReadStream) {
      this.currentReadStream.unpipe();
      this.currentReadStream.destroy();
      this.currentReadStream = null;
    }
    if (this.currentSocket) {
      this.currentSocket.destroy();
      this.currentSocket = null;
    }
    console.log('[Transfer] Sender paused');
  }

  cancel() {
    this.stop();
    console.log('[Transfer] Sender cancelled');
  }

  stop() {
    this.pause();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

export class FileReceiver {
  private socket: net.Socket | null = null;
  private writeStream: fs.WriteStream | null = null;
  private bytesReceived = 0;
  private totalBytes = 0;
  private transferId = '';
  private savePath = '';
  private senderIp = '';
  private senderPort = 0;
  private startTime = 0;
  private lastReportTime = 0;
  private lastReportBytes = 0;

  receive(
    senderIp: string,
    senderPort: number,
    savePath: string,
    totalBytes: number,
    transferId: string,
    onProgress: (p: TransferProgress) => void
  ): Promise<void> {
    this.senderIp = senderIp;
    this.senderPort = senderPort;
    this.savePath = savePath;
    this.totalBytes = totalBytes;
    this.transferId = transferId;

    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      // 'a' flag for appending on resume
      this.writeStream = fs.createWriteStream(this.savePath, { flags: this.bytesReceived > 0 ? 'a' : 'w' });

      this.socket.connect(this.senderPort, this.senderIp, () => {
        console.log(`[Transfer] Connected to sender at ${this.senderIp}:${this.senderPort}`);
        this.startTime = Date.now();
        this.lastReportTime = this.startTime;
        this.lastReportBytes = this.bytesReceived;
      });

      this.socket.on('data', (chunk) => {
        this.bytesReceived += chunk.length;
        
        const now = Date.now();
        if (now - this.lastReportTime >= 800) {
          const speed = (this.bytesReceived - this.lastReportBytes) / ((now - this.lastReportTime) / 1000);
          const remaining = (this.totalBytes - this.bytesReceived) / speed;
          
          onProgress({
            transferId: this.transferId,
            bytesTransferred: this.bytesReceived,
            totalBytes: this.totalBytes,
            status: 'active',
            speed,
            timeRemaining: isFinite(remaining) ? remaining : -1
          });
          
          this.lastReportTime = now;
          this.lastReportBytes = this.bytesReceived;
        }
      });

      this.socket.on('end', () => {
        if (this.bytesReceived >= this.totalBytes) {
           onProgress({
            transferId: this.transferId,
            bytesTransferred: this.totalBytes,
            totalBytes: this.totalBytes,
            status: 'completed'
          });
          this.writeStream?.end();
          resolve();
        }
      });

      this.socket.on('error', (err) => {
        onProgress({
          transferId: this.transferId,
          bytesTransferred: this.bytesReceived,
          totalBytes: this.totalBytes,
          status: 'error',
          error: err.message
        });
        reject(err);
      });

      this.socket.pipe(this.writeStream);
    });
  }

  pause() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }

  cancel() {
    this.pause();
    if (fs.existsSync(this.savePath)) {
      fs.unlinkSync(this.savePath);
    }
  }
}
