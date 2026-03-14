export interface P2PDiscoveryPacket {
  protocol_version: number;
  device_id: string; // UUID of broadcaster
  display_name: string;
  p2p_tcp_port: number; // 54546 by default
  identity_key_fingerprint: string;
  capabilities: number; // Bitflags for future expansion
}

export interface WebRTCSignalingMessage {
  type: 'offer' | 'answer' | 'candidate';
  sender_device_id: string;
  recipient_device_id: string;
  payload: any; // SDP or ICE candidate
}
