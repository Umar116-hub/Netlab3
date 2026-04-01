const http = require('http');

async function testLogin(username, deviceId) {
    const data = JSON.stringify({
        username: username,
        password: "testpass",
        device_id: deviceId
    });

    const options = {
        hostname: 'localhost',
        port: 3002,
        path: '/api/auth/login',
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
            res.on('end', () => {
                console.log('Login Response:', res.statusCode, body);
                resolve({ status: res.statusCode, body: JSON.parse(body) });
            });
        });

        req.on('error', (error) => {
            console.error('Login Error:', error);
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

async function runTests() {
    const username = "testuser_" + Date.now();
    const deviceId = "device_" + Date.now();
    await testRegister(username, deviceId);
    await testLogin(username, deviceId);
}

async function testRegister(username, deviceId) {
    const data = JSON.stringify({
        username: username,
        password: "testpass",
        device_id: deviceId,
        identity_key_public: "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=",
        identity_key_fingerprint: "fingerprint123"
    });

    const options = {
        hostname: 'localhost',
        port: 3002,
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
            res.on('end', () => {
                console.log('Register Response:', res.statusCode, body);
                resolve({ status: res.statusCode, body });
            });
        });

        req.on('error', (error) => {
            console.error('Register Error:', error);
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

runTests().catch(console.error);
