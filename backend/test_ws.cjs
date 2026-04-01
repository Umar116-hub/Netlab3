const http = require('http');
const WebSocket = require('ws');

async function testRegister(username, deviceId) {
    const data = JSON.stringify({
        username,
        password: "testpass",
        device_id: deviceId,
        identity_key_public: "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=",
        identity_key_fingerprint: "fingerprint123"
    });

    const options = {
        hostname: 'localhost',
        port: 3004,
        path: '/api/auth/register',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function testLogin(username, deviceId) {
    const data = JSON.stringify({ username, password: "testpass", device_id: deviceId });
    const options = {
        hostname: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    };

    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function runWsTest() {
    const username = "wsuser_" + Date.now();
    const deviceId = "wsdevice_" + Date.now();
    
    console.log('Registering user...');
    await testRegister(username, deviceId);
    
    console.log('Logging in...');
    const loginRes = await testLogin(username, deviceId);
    const token = loginRes.body.token;
    console.log('Login successful, token:', token);
    
    const wsUrl = `ws://localhost:3004/ws?token=${token}`;
    console.log('Connecting to WebSocket:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    
    ws.on('open', () => {
        console.log('WS Connection opened');
        ws.send(JSON.stringify({ type: 'ping' }));
    });
    
    ws.on('message', (data) => {
        console.log('WS RAW Received:', data.toString());
        const msg = JSON.parse(data.toString());
        console.log('WS Parsed:', msg);
        if (msg.type === 'pong') {
            console.log('WS SUCCESS: Received pong from server');
            ws.close();
            process.exit(0);
        }
    });

    ws.on('error', (err) => {
        console.error('WS Error:', err);
        process.exit(1);
    });

    ws.on('close', () => {
        console.log('WS Connection closed');
    });

    // Timeout after 10s
    setTimeout(() => {
        console.error('WS TIMEOUT: Did not receive pong in 10s');
        process.exit(1);
    }, 10000);
}

runWsTest().catch(console.error);
