import dgram from 'dgram';
import { P2PDiscoveryPacket } from '../../../shared/types/p2p';

const BROADCAST_PORT = 54545;
const BROADCAST_ADDR = '255.255.255.255';
const DISCOVERY_INTERVAL = 5000;
const OFFLINE_TIMEOUT = 15000;

export class DiscoveryService {
  private socket = dgram.createSocket('udp4');
  private peers = new Map<string, { lastSeen: number; info: P2PDiscoveryPacket }>();
  private myProfile: P2PDiscoveryPacket | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;

  start(profile: P2PDiscoveryPacket) {
    this.myProfile = profile;

    this.socket.on('message', (msg, rinfo) => {
      try {
        const packet = JSON.parse(msg.toString()) as P2PDiscoveryPacket;
        // Ignore self
        if (packet.device_id === this.myProfile?.device_id) return;
        
        this.peers.set(packet.device_id, {
          lastSeen: Date.now(),
          info: packet
        });
        
        console.log(`Discovered Peer: ${packet.display_name} @ ${rinfo.address}`);
      } catch (err) { }
    });

    this.socket.bind(BROADCAST_PORT, () => {
      this.socket.setBroadcast(true);
      
      this.intervalTimer = setInterval(() => {
        this.broadcast();
        this.pruneOfflinePeers();
      }, DISCOVERY_INTERVAL);
    });
  }

  private broadcast() {
    if (!this.myProfile) return;
    const msg = Buffer.from(JSON.stringify(this.myProfile));
    this.socket.send(msg, 0, msg.length, BROADCAST_PORT, BROADCAST_ADDR);
  }

  private pruneOfflinePeers() {
    const now = Date.now();
    for (const [deviceId, peer] of this.peers.entries()) {
      if (now - peer.lastSeen > OFFLINE_TIMEOUT) {
        console.log(`Peer Offline: ${peer.info.display_name}`);
        this.peers.delete(deviceId);
      }
    }
  }

  getPeers() {
    return Array.from(this.peers.values()).map(p => p.info);
  }

  stop() {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.socket.close();
  }
}
