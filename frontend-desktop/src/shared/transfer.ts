import net from 'net';
import fs from 'fs';

const CHUNK_SIZE = 1024 * 1024; // 1 MiB chunk definitions
const DEFAULT_TCP_PORT = 54546;

export class FileTransferService {
  private server: net.Server | null = null;
  private activeUploads = new Map<string, net.Socket>();
  private activeDownloads = new Map<string, { bytesReceived: number, fileStream: fs.WriteStream }>();

  /**
   * Start listening for incoming file transfers from peers.
   */
  startListener(saveDirectory: string) {
    this.server = net.createServer((socket) => {
      let currentFileId: string | null = null;

      socket.on('data', (data) => {
        // v1 simplistic implementation: 
        // 1. Expected first payload is JSON descriptor "{ fileId, fileName, size }"
        // 2. Subsequent packets are file bytes
        
        if (!currentFileId) {
          try {
            const headerStr = data.toString('utf-8');
            const [metadataJson, ...rest] = headerStr.split('\n\n'); // header delimiter
            const meta = JSON.parse(metadataJson);
            currentFileId = meta.fileId;

            const savePath = `${saveDirectory}/${meta.fileName}`;
            const fileStream = fs.createWriteStream(savePath);
            this.activeDownloads.set(currentFileId!, { bytesReceived: 0, fileStream });

            // If there's leftover body data in the first chunk, write it
            if (rest.length > 0) {
              const bodyBuffer = Buffer.from(rest.join('\n\n'), 'utf-8'); // recover the rest
              fileStream.write(bodyBuffer);
              this.activeDownloads.get(currentFileId!)!.bytesReceived += bodyBuffer.length;
            }

            // Send explicit ACK for delivery receipt rules
            socket.write(JSON.stringify({ type: 'ack', fileId: currentFileId, status: 'started' }) + '\n\n');

          } catch(e) {
             socket.end(); // Bad sequence
          }
        } else {
          // Streaming direct bytes
          const download = this.activeDownloads.get(currentFileId);
          if (download) {
            download.fileStream.write(data);
            download.bytesReceived += data.length;
          }
        }
      });

      socket.on('end', () => {
         if (currentFileId && this.activeDownloads.has(currentFileId)) {
             const { fileStream } = this.activeDownloads.get(currentFileId)!;
             fileStream.close();
             console.log(`File download complete: ${currentFileId}`);
             this.activeDownloads.delete(currentFileId);
         }
      });

      socket.on('error', (err) => console.error('P2P RX Error:', err));
    });

    this.server.listen(DEFAULT_TCP_PORT, '0.0.0.0', () => {
      console.log(`P2P File Transfer Server listening on port ${DEFAULT_TCP_PORT}`);
    });
  }

  /**
   * Push a file payload directly to a local peer via TCP.
   */
  async sendFile(peerAddress: string, filePath: string, fileId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      
      socket.connect(DEFAULT_TCP_PORT, peerAddress, () => {
         const stats = fs.statSync(filePath);
         const fileName = filePath.split(/[\\/]/).pop();
         
         const header = JSON.stringify({ fileId, fileName, size: stats.size });
         // Send header delimited by double newline
         socket.write(header + '\n\n');
      });

      socket.on('data', (data) => {
        try {
           const str = data.toString('utf-8');
           const [msg, ...rest] = str.split('\n\n');
           const reply = JSON.parse(msg);
           if (reply.type === 'ack' && reply.status === 'started') {
              // Now we stream the file binary
              const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
              stream.pipe(socket);

              stream.on('end', () => {
                  socket.end(); // Closing triggers physical transmission finish
                  resolve();
              });
           }
        } catch(e) {}
      });

      socket.on('error', (err) => {
         reject(err);
      });
    });
  }

  stop() {
    if (this.server) this.server.close();
  }
}
