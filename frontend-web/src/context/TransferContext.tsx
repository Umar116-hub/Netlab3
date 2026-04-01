import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useWebSocket } from './AuthContext';
import type { WebRTCSignalingMessage, FileTransferSignaling } from '@shared/types/p2p.js';

export interface ActiveTransfer {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'active' | 'completed' | 'error';
  direction: 'sending' | 'receiving';
  peerId: string;
}

interface TransferContextValue {
  transfers: ActiveTransfer[];
  sendFile: (contactId: string, file: File) => Promise<void>;
  acceptFile: (peerId: string) => Promise<void>;
}

const TransferContext = createContext<TransferContextValue | null>(null);

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

export function TransferProvider({ children }: { children: ReactNode }) {
  const { send, addListener, removeListener } = useWebSocket();
  const [transfers, setTransfers] = useState<ActiveTransfer[]>([]);
  const [peerConnections] = useState<Map<string, RTCPeerConnection>>(new Map());
  const [dataChannels] = useState<Map<string, RTCDataChannel>>(new Map());
  const [pendingSignals] = useState<Map<string, { peerId: string, signal: any }>>(new Map());

  // Handle WebRTC Signaling via listener
  useEffect(() => {
    const handleMessage = (msg: any) => {
      if (msg.type === 'webrtc_signaling' && msg.payload) {
        const { sender_id, payload } = msg;
        console.log(`[P2P] Incoming signal from ${sender_id}:`, payload.type);
        handleSignalingMessage(sender_id, payload);
      } else if (msg.type === 'file_offer') {
         const offer = msg as unknown as FileTransferSignaling;
         console.log(`[P2P] Received file offer for "${offer.file_info.name}" from ${offer.sender_id}`);
         setTransfers(prev => {
           if (prev.some(t => t.id === offer.file_info.transfer_id)) return prev;
           return [...prev, {
             id: offer.file_info.transfer_id,
             name: offer.file_info.name,
             size: offer.file_info.size,
             progress: 0,
             status: 'pending',
             direction: 'receiving',
             peerId: offer.sender_id
           }];
         });
      } else if (msg.type === 'signaling_status') {
        const color = msg.status === 'delivered' ? '#4CAF50' : '#F44336';
        console.log(`%c[WS] Signal ${msg.msg_type} to ${msg.to}: ${msg.status}${msg.reason ? ' (' + msg.reason + ')' : ''}`, `color: ${color}; font-weight: bold;`);
      }
    };

    addListener(handleMessage);
    return () => removeListener(handleMessage);
  }, [addListener, removeListener]);

  const [candidateQueue] = useState<Map<string, RTCIceCandidateInit[]>>(new Map());

  const handleSignalingMessage = async (peerId: string, signal: WebRTCSignalingMessage) => {
    console.log(`[P2P] Handling ${signal.type} from ${peerId}`);
    let pc = peerConnections.get(peerId);
    
    if (!pc) {
      pc = createPeerConnection(peerId);
    }

    try {
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
        
        // Store signal to be answered when user clicks "Accept"
        console.log(`[P2P] Offer for peer ${peerId} staged. Waiting for user to Accept...`);
        pendingSignals.set(peerId, { peerId, signal });

        // Process any queued candidates now that remote description is set
        const queued = candidateQueue.get(peerId);
        if (queued) {
          console.log(`[P2P] Processing ${queued.length} queued candidates for ${peerId}`);
          for (const cand of queued) {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          }
          candidateQueue.delete(peerId);
        }
      } else if (signal.type === 'answer') {
        console.log(`[P2P] Received ANSWER from ${peerId}. Completing sender-side handshake.`);
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
        
        // Process any queued candidates now that remote description is set
        const queued = candidateQueue.get(peerId);
        if (queued) {
          console.log(`[P2P] Processing ${queued.length} queued candidates for ${peerId}`);
          for (const cand of queued) {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          }
          candidateQueue.delete(peerId);
        }
      } else if (signal.type === 'candidate') {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.payload));
        } else {
          console.log(`[P2P] Queuing candidate for ${peerId} (remote description not ready)`);
          const queue = candidateQueue.get(peerId) || [];
          queue.push(signal.payload);
          candidateQueue.set(peerId, queue);
        }
      }
    } catch (err) {
      console.error(`[P2P] Signaling error (${signal.type}) for ${peerId}:`, err);
    }
  };

  const createPeerConnection = (peerId: string) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnections.set(peerId, pc);

    pc.onsignalingstatechange = () => {
      console.log(`[P2P] Signaling State (${peerId}):`, pc.signalingState);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Detailed log of the candidate found
        const type = event.candidate.candidate.split(' ')[7];
        console.log(`[P2P] Local ICE Candidate (${type}):`, event.candidate.candidate);
        
        send({
          type: 'webrtc_signaling',
          recipient_id: peerId,
          payload: { type: 'candidate', payload: event.candidate }
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[P2P] ICE Connection State (${peerId}):`, pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.error(`[P2P] Connection to ${peerId} failed/dropped`);
      }
    };

    pc.ondatachannel = (event) => {
      console.log(`[P2P] DataChannel received from ${peerId}`);
      setupDataChannel(peerId, event.channel);
    };

    return pc;
  };

  const setupDataChannel = (peerId: string, channel: RTCDataChannel) => {
    dataChannels.set(peerId, channel);
    channel.binaryType = 'arraybuffer'; // Enforce ArrayBuffer instead of Blob
    
    let receivedChunks: ArrayBuffer[] = [];
    let receivedSize = 0;
    let currentTransferId: string | null = null;
    let expectedSize = 0;
    let transferName = '';
    let lastReportedProgress = 0;

    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const meta = JSON.parse(event.data);
        if (meta.type === 'file_meta') {
           currentTransferId = meta.transfer_id;
           expectedSize = meta.size;
           transferName = meta.name;
           setTransfers(prev => prev.map(t => t.id === meta.transfer_id ? { ...t, status: 'active' } : t));
        }
      } else {
        const chunk = event.data as ArrayBuffer;
        receivedChunks.push(chunk);
        receivedSize += chunk.byteLength || (chunk as any).size || 0;
        
        if (currentTransferId && expectedSize > 0) {
           const currentProgress = Math.floor((receivedSize / expectedSize) * 100);
           
           if (receivedSize >= expectedSize) {
             // Completion
             const blob = new Blob(receivedChunks);
             const url = URL.createObjectURL(blob);
             const a = document.createElement('a');
             a.href = url;
             a.download = transferName;
             a.click();
             
             setTransfers(prev => prev.map(tx => tx.id === currentTransferId ? { ...tx, progress: 100, status: 'completed' } : tx));
             // Reset
             receivedChunks = [];
             receivedSize = 0;
             lastReportedProgress = 0;
           } else if (currentProgress > lastReportedProgress) {
             lastReportedProgress = currentProgress;
             setTransfers(prev => prev.map(tx => tx.id === currentTransferId ? { ...tx, progress: currentProgress } : tx));
           }
        }
      }
    };
  };

  const sendFile = async (contactId: string, file: File) => {
    console.log(`[P2P] Initializing transfer of "${file.name}" to ${contactId}`);
    const transferId = Math.random().toString(36).substring(7);
    setTransfers(prev => [...prev, {
      id: transferId,
      name: file.name,
      size: file.size,
      progress: 0,
      status: 'pending',
      direction: 'sending',
      peerId: contactId
    }]);

    // 1. Create PC
    const pc = createPeerConnection(contactId);
    
    // 2. Create Data Channel
    const channel = pc.createDataChannel('fileTransfer');
    dataChannels.set(contactId, channel);

    channel.onopen = async () => {
      // Send Metadata
      channel.send(JSON.stringify({
        type: 'file_meta',
        name: file.name,
        size: file.size,
        transfer_id: transferId
      }));

      // Send File Chunks
      const chunkSize = 65536; // 64KB - much faster payload mapping
      let offset = 0;
      let lastReportedProgress = 0;

      const readSlice = async () => {
        if (offset >= file.size) return;
        
        // Use modern arrayBuffer() for much faster slicing than FileReader
        const slice = file.slice(offset, offset + chunkSize);
        const buffer = await slice.arrayBuffer();
        
        channel.send(buffer);
        offset += buffer.byteLength;
        
        const currentProgress = Math.floor((offset / file.size) * 100);
        // Throttle React state updates to every 1% to prevent CPU UI threading death
        if (currentProgress > lastReportedProgress || offset >= file.size) {
           lastReportedProgress = currentProgress;
           setTransfers(prev => prev.map(t => t.id === transferId ? { 
             ...t, 
             progress: offset >= file.size ? 100 : currentProgress, 
             status: offset >= file.size ? 'completed' : 'active' 
           } : t));
        }

        if (offset < file.size) {
           // Handle backpressure so we don't crash the browser's SCTP buffer
           if (channel.bufferedAmount > channel.bufferedAmountLowThreshold) {
              channel.onbufferedamountlow = () => {
                 channel.onbufferedamountlow = null;
                 readSlice();
              };
           } else {
              // Yield to event loop to allow UI thread to breathe
              setTimeout(() => readSlice(), 0);
           }
        }
      };

      readSlice();
    };

    // 3. Create Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    // 4. Send Offer via Signaling
    console.log(`[P2P] Sending offer to ${contactId}`);
    send({
      type: 'webrtc_signaling',
      recipient_id: contactId,
      payload: { type: 'offer', payload: offer }
    });

    // Also send file_offer for UI notification
    console.log(`[P2P] Sending file_offer to ${contactId}`);
    send({
      type: 'file_offer',
      recipient_id: contactId,
      file_info: {
        name: file.name,
        size: file.size,
        type: file.type,
        transfer_id: transferId
      }
    });
  };

  const acceptFile = async (peerId: string) => {
    const pending = pendingSignals.get(peerId);
    
    if (!pending || pending.signal.type !== 'offer') {
      console.warn(`[P2P] No pending offer found for ${peerId}`);
      return;
    }

    console.log(`[P2P] User accepted transfer from ${peerId}. Completing handshake...`);
    const pc = peerConnections.get(peerId);
    if (!pc) return;

    try {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({
        type: 'webrtc_signaling',
        recipient_id: peerId,
        payload: { type: 'answer', payload: answer }
      });
      pendingSignals.delete(peerId);
      console.log('[P2P] Answer sent to sender');
    } catch (err) {
      console.error('[P2P] Failed to create/send answer:', err);
    }
  };

  return (
    <TransferContext.Provider value={{ transfers, sendFile, acceptFile }}>
      {children}
    </TransferContext.Provider>
  );
}

export function useTransfer() {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error('useTransfer must be inside <TransferProvider>');
  return ctx;
}
