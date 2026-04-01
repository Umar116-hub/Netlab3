import dgram from 'dgram';
import os from 'os';
import type { P2PDiscoveryPacket } from '@shared/types/p2p.js';

const BROADCAST_PORT = 54545;
const BROADCAST_ADDR = '255.255.255.255';
const DISCOVERY_INTERVAL = 5000;
const OFFLINE_TIMEOUT = 15000;

export class DiscoveryService {
  private socket = dgram.createSocket('udp4');
  private peers = new Map<string, { lastSeen: number; info: P2PDiscoveryPacket }>();
  private myProfile: P2PDiscoveryPacket | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;

  start(profile: P2PDiscoveryPacket, onPeerDiscovered?: (ip: string, packet: P2PDiscoveryPacket) => void) {
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
        
        if (onPeerDiscovered) {
          onPeerDiscovered(rinfo.address, packet);
        }
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

    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
      const ifaceList = interfaces[name];
      if (!ifaceList) continue;

      for (const iface of ifaceList) {
        if (iface.family === 'IPv4' && !iface.internal) {
          // Calculate subnet broadcast (assuming /24 which is default for LANs)
          const subnetBroadcast = iface.address.split('.').slice(0, 3).join('.') + '.255';
          this.socket.send(msg, 0, msg.length, BROADCAST_PORT, subnetBroadcast);
        }
      }
    }

    // Fallback to global broadcast
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
