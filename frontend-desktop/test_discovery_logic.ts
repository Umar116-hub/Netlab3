import { DiscoveryService } from './src/shared/discovery';
import type { P2PDiscoveryPacket } from '@shared/types/p2p.js';

console.log('Starting UDP Discovery Test (TSX)...');

const myProfile: P2PDiscoveryPacket = {
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
