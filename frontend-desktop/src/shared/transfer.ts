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
    this.bytesSent = 0;
    this.startTime = Date.now();
    this.lastReportTime = this.startTime;
    this.lastReportBytes = 0;

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        socket.setNoDelay(true);
        this.activeSockets.add(socket);

        let handshakeBuffer = Buffer.alloc(0);
        
        const onData = (chunk: Buffer) => {
           handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
           if (handshakeBuffer.length >= 16) {
              const startBig = handshakeBuffer.readBigUInt64BE(0);
              const endBig = handshakeBuffer.readBigUInt64BE(8);
              const start = Number(startBig);
              const end = Number(endBig);
              
              socket.off('data', onData); // Detach after handshake
              this.streamRange(socket, start, end, onProgress);
           }
        };

        socket.on('data', onData);
        socket.on('close', () => this.activeSockets.delete(socket));
        socket.on('error', (err) => console.error('[Sender] Socket error:', err));
      });

      this.server.on('error', (err) => reject(err));

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
       highWaterMark: 512 * 1024 // 512KB Stable Buffer
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
        if (this.bytesSent >= this.totalBytes && this.activeStreams.size === 0) {
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
  private inFlightWrites = 0;
  private streamCount = 4; // Stable "Sweet Spot"
  private streamsEnded = 0;

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
    this.bytesReceived = 0;
    this.lastReportTime = Date.now();
    this.lastReportBytes = 0;
    this.inFlightWrites = 0;
    this.streamsEnded = 0;

    return new Promise((resolve, reject) => {
      try {
        this.fileDescriptor = fs.openSync(this.savePath, 'w');
      } catch (e: any) {
        return reject(e);
      }

      const segmentSize = Math.ceil(this.totalBytes / this.streamCount);

      for (let i = 0; i < this.streamCount; i++) {
        const start = i * segmentSize;
        const end = Math.min((i + 1) * segmentSize, this.totalBytes);
        
        if (start >= this.totalBytes) {
           this.handleStreamEnd(onProgress, resolve);
           continue; 
        }

        const socket = new net.Socket();
        socket.setNoDelay(true);
        this.sockets.add(socket);

        socket.connect(senderPort, senderIp, () => {
          const header = Buffer.allocUnsafe(16);
          header.writeBigUInt64BE(BigInt(start), 0);
          header.writeBigUInt64BE(BigInt(end), 8);
          socket.write(header);
        });

        let streamBuffer = Buffer.allocUnsafe(1024 * 1024); // 1MB batch
        let streamBufferLen = 0;
        let currentWriteOffset = start;

        const flushStreamBuffer = () => {
           if (this.fileDescriptor === null || streamBufferLen === 0) return;
           
           // CLONE BUFFER: This prevents the async race condition!
           // Each write now has its own isolated memory space.
           const dataToWrite = Buffer.allocUnsafe(streamBufferLen);
           streamBuffer.copy(dataToWrite, 0, 0, streamBufferLen);
           
           const fd = this.fileDescriptor;
           const pos = currentWriteOffset;
           
           this.inFlightWrites++;
           fs.write(fd, dataToWrite, 0, dataToWrite.length, pos, (err) => {
              this.inFlightWrites--;
              if (err) console.error('[Receiver] Async write error:', err);
              if (this.streamsEnded >= this.streamCount && this.inFlightWrites === 0) {
                 this.finish(onProgress, resolve);
              }
           });

           currentWriteOffset += streamBufferLen;
           streamBufferLen = 0;
        };

        socket.on('data', (chunk) => {
          if (this.fileDescriptor === null) return;
          
          if (streamBufferLen + chunk.length <= streamBuffer.length) {
             chunk.copy(streamBuffer, streamBufferLen);
             streamBufferLen += chunk.length;
          } else {
             flushStreamBuffer();
             if (chunk.length > streamBuffer.length) {
                // Direct async write for jumbo chunks
                const fd = this.fileDescriptor;
                const pos = currentWriteOffset;
                const directChunk = Buffer.from(chunk); // Must copy to keep memory safe
                this.inFlightWrites++;
                fs.write(fd, directChunk, 0, directChunk.length, pos, (err) => {
                   this.inFlightWrites--;
                   if (this.streamsEnded >= this.streamCount && this.inFlightWrites === 0) {
                      this.finish(onProgress, resolve);
                   }
                });
                currentWriteOffset += chunk.length;
             } else {
                chunk.copy(streamBuffer, 0);
                streamBufferLen = chunk.length;
             }
          }

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
          flushStreamBuffer();
          this.handleStreamEnd(onProgress, resolve);
        });

        socket.on('error', (err) => {
          this.pause();
          reject(err);
        });
      }
    });
  }

  private handleStreamEnd(onProgress: (p: TransferProgress) => void, resolve: () => void) {
     this.streamsEnded++;
     if (this.streamsEnded >= this.streamCount && this.inFlightWrites === 0) {
        this.finish(onProgress, resolve);
     }
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
    this.stop();
    if (fs.existsSync(this.savePath)) fs.unlinkSync(this.savePath);
  }

  stop() {
     this.pause();
  }
}
