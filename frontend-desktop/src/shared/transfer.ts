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
  private activeStreams: Set<fs.ReadStream> = new Set();
  private activeSockets: Set<net.Socket> = new Set();
  private bytesSent = 0;
  private totalBytes = 0;
  private transferId = '';
  private filePath = '';
  private startTime = 0;
  private lastReportTime = 0;
  private lastReportBytes = 0;

  start(filePath: string, transferId: string, onProgress: (p: TransferProgress) => void): Promise<{ port: number }> {
    this.filePath = filePath;
    const stats = fs.statSync(filePath);
    this.totalBytes = stats.size;
    this.transferId = transferId;
    this.bytesSent = 0; // State reset (fixes progress bugs)
    this.startTime = Date.now();
    this.lastReportTime = this.startTime;
    this.lastReportBytes = 0;

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        socket.setNoDelay(true);
        this.activeSockets.add(socket);

        let handshakeBuffer = Buffer.alloc(0);
        
        socket.on('data', (chunk) => {
          // Handshake protocol: Receiver sends a JSON range request first: {"start": n, "end": m}
          if (handshakeBuffer.length < 1024) { // Small buffer for JSON meta
             const terminatorIndex = chunk.indexOf('\n');
             if (terminatorIndex !== -1) {
                const fullMsg = Buffer.concat([handshakeBuffer, chunk.slice(0, terminatorIndex)]).toString();
                try {
                   const { start, end } = JSON.parse(fullMsg);
                   this.streamRange(socket, start, end, onProgress);
                   // Remove processed part
                } catch (e) {
                   console.error('[Sender] Handshake parse error', e);
                }
             } else {
                handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
             }
          }
        });

        socket.on('close', () => {
          this.activeSockets.delete(socket);
        });

        socket.on('error', (err) => {
          console.error('[Sender] Socket error:', err);
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

  private streamRange(socket: net.Socket, start: number, end: number, onProgress: (p: TransferProgress) => void) {
     const readStream = fs.createReadStream(this.filePath, { 
       start, 
       end: end - 1, 
       highWaterMark: 512 * 1024 
     });
     this.activeStreams.add(readStream);

     readStream.on('data', (chunk) => {
        this.bytesSent += chunk.length;
        const now = Date.now();
        if (now - this.lastReportTime >= 1500) {
           const speed = (this.bytesSent - this.lastReportBytes) / ((now - this.lastReportTime) / 1000);
           const remaining = (this.totalBytes - this.bytesSent) / speed;
           onProgress({
              transferId: this.transferId,
              bytesTransferred: Math.min(this.bytesSent, this.totalBytes),
              totalBytes: this.totalBytes,
              status: 'active',
              speed,
              timeRemaining: isFinite(remaining) ? remaining : -1
           });
           this.lastReportTime = now;
           this.lastReportBytes = this.bytesSent;
        }
     });

     readStream.on('end', () => {
        this.activeStreams.delete(readStream);
        if (this.bytesSent >= this.totalBytes) {
           onProgress({
              transferId: this.transferId,
              bytesTransferred: this.totalBytes,
              totalBytes: this.totalBytes,
              status: 'completed'
           });
        }
     });

     readStream.pipe(socket);
  }

  pause() {
    this.activeStreams.forEach(s => s.destroy());
    this.activeStreams.clear();
    this.activeSockets.forEach(s => s.destroy());
    this.activeSockets.clear();
  }

  cancel() {
    this.stop();
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
  private sockets: Set<net.Socket> = new Set();
  private bytesReceived = 0;
  private totalBytes = 0;
  private transferId = '';
  private savePath = '';
  private fileDescriptor: number | null = null;
  private lastReportTime = 0;
  private lastReportBytes = 0;
  private streamCount = 4; // Lvl 2 Turbo: 4 Parallel Streams

  receive(
    senderIp: string,
    senderPort: number,
    savePath: string,
    totalBytes: number,
    transferId: string,
    onProgress: (p: TransferProgress) => void
  ): Promise<void> {
    this.savePath = savePath;
    this.totalBytes = totalBytes;
    this.transferId = transferId;
    this.bytesReceived = 0; // State reset (fixes 120% bug)
    this.lastReportTime = Date.now();
    this.lastReportBytes = 0;

    return new Promise((resolve, reject) => {
      // Open file with sync to allow atomic offset-based writes
      try {
        this.fileDescriptor = fs.openSync(this.savePath, 'w');
      } catch (e: any) {
        return reject(e);
      }

      const segmentSize = Math.ceil(this.totalBytes / this.streamCount);
      let streamsCompleted = 0;

      for (let i = 0; i < this.streamCount; i++) {
        const start = i * segmentSize;
        const end = Math.min((i + 1) * segmentSize, this.totalBytes);
        
        if (start >= this.totalBytes) {
           streamsCompleted++;
           continue; 
        }

        const socket = new net.Socket();
        socket.setNoDelay(true);
        this.sockets.add(socket);

        socket.connect(senderPort, senderIp, () => {
          // Send Range Request Handshake
          socket.write(JSON.stringify({ start, end, transferId }) + '\n');
        });

        let currentWriteOffset = start;

        socket.on('data', (chunk) => {
          if (this.fileDescriptor === null) return;
          
          fs.writeSync(this.fileDescriptor, chunk, 0, chunk.length, currentWriteOffset);
          currentWriteOffset += chunk.length;
          this.bytesReceived += chunk.length;

          const now = Date.now();
          if (now - this.lastReportTime >= 1500) {
            const speed = (this.bytesReceived - this.lastReportBytes) / ((now - this.lastReportTime) / 1000);
            const remaining = (this.totalBytes - this.bytesReceived) / speed;
            onProgress({
              transferId: this.transferId,
              bytesTransferred: Math.min(this.bytesReceived, this.totalBytes),
              totalBytes: this.totalBytes,
              status: 'active',
              speed,
              timeRemaining: isFinite(remaining) ? remaining : -1
            });
            this.lastReportTime = now;
            this.lastReportBytes = this.bytesReceived;
          }
        });

        socket.on('end', () => {
          streamsCompleted++;
          if (streamsCompleted >= this.streamCount) {
            this.finish(onProgress, resolve);
          }
        });

        socket.on('error', (err) => {
          this.pause();
          reject(err);
        });
      }
    });
  }

  private finish(onProgress: (p: TransferProgress) => void, resolve: () => void) {
    if (this.fileDescriptor !== null) {
      fs.closeSync(this.fileDescriptor);
      this.fileDescriptor = null;
    }
    onProgress({
      transferId: this.transferId,
      bytesTransferred: this.totalBytes,
      totalBytes: this.totalBytes,
      status: 'completed'
    });
    resolve();
  }

  pause() {
    this.sockets.forEach(s => s.destroy());
    this.sockets.clear();
    if (this.fileDescriptor !== null) {
       fs.closeSync(this.fileDescriptor);
       this.fileDescriptor = null;
    }
  }

  cancel() {
    this.pause();
    if (fs.existsSync(this.savePath)) {
      fs.unlinkSync(this.savePath);
    }
  }
}
