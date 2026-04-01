const dgram = require('dgram');

const BROADCAST_PORT = 54545;
const BROADCAST_ADDR = '255.255.255.255';

const mockProfile = {
  protocol_version: 1,
  device_id: 'mock-device-id-12345',
  account_id: 'mock-account-id-charlie',
  display_name: 'Charlie (Mock LAN Peer)',
  p2p_tcp_port: 54546,
  identity_key_fingerprint: 'mock-fp-charlie',
  capabilities: 1,
};

const socket = dgram.createSocket('udp4');

socket.bind(() => {
  socket.setBroadcast(true);
  console.log('Simulating LAN Peer broadcast on port', BROADCAST_PORT);
  
  setInterval(() => {
    const msg = Buffer.from(JSON.stringify(mockProfile));
    socket.send(msg, 0, msg.length, BROADCAST_PORT, BROADCAST_ADDR);
    console.log('Broadcasted mock peer info...');
  }, 2000);
});
