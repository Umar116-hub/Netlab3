import net from 'net';
import fs from 'fs';
export class FileSender {
    server = null;
    start(filePath, onProgress) {
        return new Promise((resolve, reject) => {
            const stats = fs.statSync(filePath);
            const totalBytes = stats.size;
            const transferId = Math.random().toString(36).substring(7);
            this.server = net.createServer((socket) => {
                console.log('Receiver connected to TCP server');
                let bytesSent = 0;
                const readStream = fs.createReadStream(filePath);
                readStream.on('data', (chunk) => {
                    bytesSent += chunk.length;
                    onProgress({
                        transferId,
                        bytesTransferred: bytesSent,
                        totalBytes,
                        status: 'active'
                    });
                });
                readStream.on('end', () => {
                    onProgress({
                        transferId,
                        bytesTransferred: totalBytes,
                        totalBytes,
                        status: 'completed'
                    });
                    socket.end();
                    this.stop();
                });
                readStream.on('error', (err) => {
                    onProgress({
                        transferId,
                        bytesTransferred: bytesSent,
                        totalBytes,
                        status: 'error',
                        error: err.message
                    });
                    this.stop();
                });
                readStream.pipe(socket);
            });
            this.server.listen(0, '0.0.0.0', () => {
                const address = this.server?.address();
                if (address && typeof address !== 'string') {
                    resolve({ port: address.port });
                }
                else {
                    reject(new Error('Failed to get server port'));
                }
            });
            this.server.on('error', (err) => {
                onProgress({
                    transferId,
                    bytesTransferred: 0,
                    totalBytes,
                    status: 'error',
                    error: err.message
                });
                reject(err);
            });
        });
    }
    stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}
export class FileReceiver {
    socket = null;
    receive(senderIp, senderPort, savePath, totalBytes, transferId, onProgress) {
        return new Promise((resolve, reject) => {
            this.socket = new net.Socket();
            let bytesReceived = 0;
            const writeStream = fs.createWriteStream(savePath);
            this.socket.connect(senderPort, senderIp, () => {
                console.log(`Connected to sender at ${senderIp}:${senderPort}`);
            });
            this.socket.on('data', (chunk) => {
                bytesReceived += chunk.length;
                onProgress({
                    transferId,
                    bytesTransferred: bytesReceived,
                    totalBytes,
                    status: 'active'
                });
            });
            this.socket.on('end', () => {
                onProgress({
                    transferId,
                    bytesTransferred: totalBytes,
                    totalBytes,
                    status: 'completed'
                });
                writeStream.end();
                resolve();
            });
            this.socket.on('error', (err) => {
                onProgress({
                    transferId,
                    bytesTransferred: bytesReceived,
                    totalBytes,
                    status: 'error',
                    error: err.message
                });
                writeStream.end();
                reject(err);
            });
            this.socket.pipe(writeStream);
        });
    }
}
