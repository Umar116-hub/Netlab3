const { DiscoveryService } = require('./src-dist/shared/discovery.js');

// We need to compile discovery.ts to JS first for this test, 
// or use ts-node/tsx. Since tsx is available:
console.log('Starting UDP Discovery Test...');

const myProfile = {
  protocol_version: 1,
  device_id: 'test-listener-device',
  account_id: 'test-listener-account',
  display_name: 'Listener Node',
  p2p_tcp_port: 54546,
  identity_key_fingerprint: 'test-fp',
  capabilities: 1,
};

const service = new DiscoveryService();
service.start(myProfile);

console.log('Listening for 10 seconds...');

const interval = setInterval(() => {
  const peers = service.getPeers();
  if (peers.length > 0) {
    console.log('SUCCESS! Discovered peers:', JSON.stringify(peers, null, 2));
    process.exit(0);
  } else {
    console.log('Waiting for peers...');
  }
}, 2000);

setTimeout(() => {
  console.log('TIMEOUT: No peers discovered.');
  process.exit(1);
}, 10000);
