export interface P2PDiscoveryPacket {
  protocol_version: number;
  device_id: string; // UUID of broadcaster
  account_id: string; // User's ID for signaling fallback
  display_name: string;
  p2p_tcp_port: number; // 54546 by default
  identity_key_fingerprint: string;
  capabilities: number; // Bitflags for future expansion
}

export interface WebRTCSignalingMessage {
  type: 'offer' | 'answer' | 'candidate';
  sender_id: string; // Account ID
  recipient_id: string; // Account ID
  payload: any; // SDP or ICE candidate
}

export interface FileTransferSignaling {
  type: 'file_offer' | 'file_accept' | 'file_reject';
  sender_id: string;
  recipient_id: string;
  file_info: {
    name: string;
    size: number;
    type: string;
    transfer_id: string;
  };
  connection_info?: {
    ip: string;
    port: number;
  };
}
