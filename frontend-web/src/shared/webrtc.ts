export class WebRTCTransferService {
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();

  private sendSignal: (targetDeviceId: string, payload: any) => void;

  // A signaling server hook would inject this function
  constructor(sendSignal: (targetDeviceId: string, payload: any) => void) {
    this.sendSignal = sendSignal;
  }

  /**
   * Initialize a connection as the Sender
   */
  async createOffer(targetDeviceId: string) {
    const pc = this.createPeerConnection(targetDeviceId);
    
    // As the sender, create the data channel
    const dc = pc.createDataChannel('fileTransfer');
    this.setupDataChannel(targetDeviceId, dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.sendSignal(targetDeviceId, { type: 'offer', offer });
  }

  /**
   * Handle an incoming offer as the Receiver
   */
  async handleOffer(targetDeviceId: string, offer: RTCSessionDescriptionInit) {
    const pc = this.createPeerConnection(targetDeviceId);

    pc.ondatachannel = (event) => {
      this.setupDataChannel(targetDeviceId, event.channel);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.sendSignal(targetDeviceId, { type: 'answer', answer });
  }

  /**
   * Handle answering connection and ICE Candidates
   */
  async handleAnswer(targetDeviceId: string, answer: RTCSessionDescriptionInit) {
    const pc = this.peerConnections.get(targetDeviceId);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async handleCandidate(targetDeviceId: string, candidate: RTCIceCandidateInit) {
    const pc = this.peerConnections.get(targetDeviceId);
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  /**
   * Internal wrapper for PeerConnection bootstrapping
   */
  private createPeerConnection(targetDeviceId: string): RTCPeerConnection {
    // Relying on LAN primarily, but we offer standard public STUN fallback
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(targetDeviceId, { type: 'candidate', candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`WebRTC state with ${targetDeviceId}: ${pc.connectionState}`);
    };

    this.peerConnections.set(targetDeviceId, pc);
    return pc;
  }

  private setupDataChannel(targetDeviceId: string, dc: RTCDataChannel) {
    dc.onopen = () => console.log(`Data Channel Open for ${targetDeviceId}`);
    dc.onclose = () => console.log(`Data Channel Closed for ${targetDeviceId}`);
    dc.onmessage = (event) => {
      // In a real application, event.data contains the file chunks or metadata headers
      console.log(`Received ${event.data.byteLength || event.data.length} bytes from ${targetDeviceId}`);
    };
    
    this.dataChannels.set(targetDeviceId, dc);
  }

  /**
   * Expose public send command
   */
  sendData(targetDeviceId: string, data: string | Blob | ArrayBuffer | ArrayBufferView) {
    const dc = this.dataChannels.get(targetDeviceId);
    if (dc && dc.readyState === 'open') {
      dc.send(data as any);
    } else {
      throw new Error("Data channel not open");
    }
  }

  close(targetDeviceId: string) {
    this.dataChannels.get(targetDeviceId)?.close();
    this.peerConnections.get(targetDeviceId)?.close();
    this.dataChannels.delete(targetDeviceId);
    this.peerConnections.delete(targetDeviceId);
  }
}
