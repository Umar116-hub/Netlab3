import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { useWebSocket } from './AuthContext';
import { uuidv4 } from '../lib/crypto';
import { api } from '../lib/api';
import type { WebRTCSignalingMessage, FileTransferSignaling } from '@shared/types/p2p.js';

export interface ActiveTransfer {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'connecting' | 'active' | 'completed' | 'error';
  direction: 'sending' | 'receiving';
  peerId: string;
  speed?: number;
  timeRemaining?: number;
}

interface TransferContextValue {
  transfers: ActiveTransfer[];
  sendFile: (contactId: string, file: File) => Promise<string>;
  acceptFile: (peerId: string, transfer_id?: string) => Promise<void>;
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

  // Use refs for mutable maps — they survive re-renders without causing effect re-runs
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map()).current;
  const pendingSignals = useRef<Map<string, { peerId: string; signal: any }>>(new Map()).current;
  const candidateQueue = useRef<Map<string, RTCIceCandidateInit[]>>(new Map()).current;
  const transferMeta = useRef<Map<string, { startTime: number; lastBytes: number; lastTime: number }>>(new Map()).current;

  // Keep `send` in a ref so callbacks always use the latest version
  const sendRef = useRef(send);
  sendRef.current = send;

  const updateTransferMetrics = (id: string, currentBytes: number, totalSize: number) => {
    const meta = transferMeta.get(id);
    const now = Date.now();
    if (!meta) {
      transferMeta.set(id, { startTime: now, lastBytes: currentBytes, lastTime: now });
      return;
    }
    const timeDiff = (now - meta.lastTime) / 1000;
    if (timeDiff >= 0.5) {
      const speed = (currentBytes - meta.lastBytes) / timeDiff;
      const timeRemaining = speed > 0 ? (totalSize - currentBytes) / speed : 0;
      setTransfers(prev => prev.map(t => (t.id === id ? { ...t, speed, timeRemaining } : t)));
      transferMeta.set(id, { ...meta, lastBytes: currentBytes, lastTime: now });
    }
  };

  // ── Signaling handler (stable ref — never recreated by useEffect) ──
  const handleSignalingMessage = async (peerId: string, signal: WebRTCSignalingMessage) => {
    let pc = peerConnections.get(peerId);

    if (signal.type === 'offer' && pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) {
      pc.close();
      peerConnections.delete(peerId);
      pc = undefined;
    }
    if (!pc) pc = createPeerConnection(peerId);

    try {
      if (signal.type === 'offer') {
        console.log(`[P2P] Handling OFFER from ${peerId}`);
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
        pendingSignals.set(peerId, { peerId, signal });
        await flushCandidateQueue(pc, peerId);
      } else if (signal.type === 'answer') {
        console.log(`[P2P] Handling ANSWER from ${peerId}`);
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
        await flushCandidateQueue(pc, peerId);
      } else if (signal.type === 'candidate') {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.payload));
        } else {
          const q = candidateQueue.get(peerId) || [];
          q.push(signal.payload);
          candidateQueue.set(peerId, q);
        }
      }
    } catch (err) {
      console.error(`[P2P] Signaling error (${signal.type}):`, err);
    }
  };

  const flushCandidateQueue = async (pc: RTCPeerConnection, peerId: string) => {
    const queued = candidateQueue.get(peerId);
    if (queued) {
      console.log(`[P2P] Processing ${queued.length} queued candidates`);
      for (const c of queued) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* skip bad candidates */ }
      }
      candidateQueue.delete(peerId);
    }
  };

  // Keep a ref to the handler so the useEffect closure never goes stale
  const signalingRef = useRef(handleSignalingMessage);
  signalingRef.current = handleSignalingMessage;

  // ── WebSocket listener — runs ONCE, never re-created on state changes ──
  useEffect(() => {
    const onMsg = (msg: any) => {
      if (msg.type === 'webrtc_signaling' && msg.payload) {
        signalingRef.current(msg.sender_id, msg.payload);
      } else if (msg.type === 'file_offer') {
        const o = msg as unknown as FileTransferSignaling;
        console.log(`[P2P] File offer: "${o.file_info.name}" from ${o.sender_id}`);
        setTransfers(prev => {
          if (prev.some(t => t.id === o.file_info.transfer_id)) return prev;
          return [...prev, {
            id: o.file_info.transfer_id, name: o.file_info.name,
            size: o.file_info.size, progress: 0, status: 'pending' as const,
            direction: 'receiving' as const, peerId: o.sender_id,
          }];
        });
      }
    };
    addListener(onMsg);
    return () => removeListener(onMsg);
  }, [addListener, removeListener]);

  // ── PeerConnection factory ──
  const createPeerConnection = (peerId: string) => {
    const pc = new RTCPeerConnection({ ...ICE_SERVERS, iceCandidatePoolSize: 10 });
    peerConnections.set(peerId, pc);

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const parts = e.candidate.candidate.split(' ');
      const ip = parts[4];
      sendRef.current({ type: 'webrtc_signaling', recipient_id: peerId, payload: { type: 'candidate', payload: e.candidate } });

      // mDNS bypass
      const host = window.location.hostname;
      if (ip.endsWith('.local') && /^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
        sendRef.current({
          type: 'webrtc_signaling', recipient_id: peerId,
          payload: { type: 'candidate', payload: { candidate: e.candidate.candidate.replace(ip, host), sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } },
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`%c[P2P] ICE: ${pc.iceConnectionState}`, 'color:#ff9800;font-weight:bold');
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
         setTransfers(p => p.map(t => {
           if (t.peerId === peerId && ['connecting', 'active'].includes(t.status)) {
             api.updateFileStatus(t.id, 'error', peerId).catch(console.error);
             return { ...t, status: 'error' };
           }
           return t;
         }));
      }
    };
    pc.onconnectionstatechange = () => {
      console.log(`%c[P2P] Conn: ${pc.connectionState}`, 'color:#00bcd4;font-weight:bold');
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
         setTransfers(p => p.map(t => {
           if (t.peerId === peerId && ['connecting', 'active'].includes(t.status)) {
             api.updateFileStatus(t.id, 'error', peerId).catch(console.error);
             return { ...t, status: 'error' };
           }
           return t;
         }));
      }
    };
    pc.ondatachannel = (e) => { console.log('[P2P] Incoming DataChannel'); setupReceiver(peerId, e.channel); };

    return pc;
  };

  // ── Receiver-side DataChannel ──
  const setupReceiver = (peerId: string, ch: RTCDataChannel) => {
    ch.binaryType = 'arraybuffer';
    let chunks: ArrayBuffer[] = [];
    let got = 0;
    let tid: string | null = null;
    let total = 0;
    let fname = '';
    let lastPct = 0;

    ch.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const m = JSON.parse(ev.data);
        if (m.type === 'file_meta') {
          console.log(`[P2P] Receiving "${m.name}" (${m.size} bytes)`);
          tid = m.transfer_id; total = m.size; fname = m.name;
          setTransfers(p => {
            const existing = p.find(t => t.id === m.transfer_id);
            if (existing) return p.map(t => (t.id === m.transfer_id ? { ...t, status: 'active' as const } : t));
            return [...p, { id: m.transfer_id, name: m.name, size: m.size, progress: 0, status: 'active', direction: 'receiving', peerId }];
          });
        }
        return;
      }
      const buf = ev.data as ArrayBuffer;
      chunks.push(buf);
      got += buf.byteLength;

      if (!tid || total <= 0) return;
      const pct = Math.floor((got / total) * 100);

      if (got >= total) {
        console.log(`%c[P2P] ✅ Received ${got} bytes`, 'color:#4CAF50;font-weight:bold');
        const blob = new Blob(chunks);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fname;
        a.click();
        setTransfers(p => p.map(t => (t.id === tid ? { ...t, progress: 100, status: 'completed' as const, speed: 0, timeRemaining: 0 } : t)));
        api.updateFileStatus(tid, 'completed', peerId).catch(console.error);
        chunks = []; got = 0; lastPct = 0;
      } else if (pct > lastPct) {
        lastPct = pct;
        setTransfers(p => p.map(t => (t.id === tid ? { ...t, progress: pct } : t)));
        updateTransferMetrics(tid, got, total);
      }
    };
    ch.onerror = (e) => {
      console.error('[P2P] Receiver channel error:', e);
      if (tid) {
         setTransfers(p => p.map(t => (t.id === tid ? { ...t, status: 'error' } : t)));
         api.updateFileStatus(tid, 'error', peerId).catch(console.error);
      }
    };
  };

  // ── Send a file ──
  const sendFile = async (contactId: string, file: File): Promise<string> => {
    console.log(`[P2P] Send "${file.name}" (${file.size} bytes) to ${contactId}`);
    const tid = uuidv4();

    setTransfers(p => [...p, { id: tid, name: file.name, size: file.size, progress: 0, status: 'pending', direction: 'sending', peerId: contactId }]);

    const pc = createPeerConnection(contactId);
    const ch = pc.createDataChannel('fileTransfer');
    ch.binaryType = 'arraybuffer';

    ch.onerror = (e) => {
      console.error('[P2P] Sender channel error:', e);
      setTransfers(p => p.map(t => (t.id === tid ? { ...t, status: 'error' } : t)));
      api.updateFileStatus(tid, 'error', contactId).catch(console.error);
    };

    ch.onopen = () => {
      console.log(`%c[P2P] ✅ DataChannel OPEN — sending "${file.name}"`, 'color:#4CAF50;font-weight:bold');
      try {
        ch.send(JSON.stringify({ type: 'file_meta', name: file.name, size: file.size, transfer_id: tid }));

        const CHUNK = 65536; // 64KB is generally best for local network P2P
        let offset = 0;
        let lastReport = Date.now();

        setTransfers(p => p.map(t => (t.id === tid ? { ...t, status: 'active' } : t)));

        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        const pump = async () => {
          try {
            while (offset < file.size && ch.readyState === 'open') {
              // Browser bug workaround: Do not trust `onbufferedamountlow`
              // If the buffer is full, simply pause the loop for 10ms and check again
              if (ch.bufferedAmount > 256 * 1024) {
                await sleep(10);
                continue;
              }

              const end = Math.min(offset + CHUNK, file.size);
              const buf = await file.slice(offset, end).arrayBuffer();
              
              if (ch.readyState !== 'open') break;

              ch.send(buf);
              offset += buf.byteLength;

              // Update the UI at most every 100ms
              const now = Date.now();
              if (now - lastReport > 100 || offset >= file.size) {
                const pct = Math.floor((offset / file.size) * 100);
                updateTransferMetrics(tid, offset, file.size);
                lastReport = now;
                setTransfers(p => p.map(t => (t.id === tid ? { ...t, progress: offset >= file.size ? 100 : pct, status: offset >= file.size ? 'completed' : 'active' } : t)));
              }
            }

            if (offset >= file.size) {
              console.log(`%c[P2P] ✅ Sent all ${file.size} bytes`, 'color:#4CAF50;font-weight:bold');
              setTransfers(p => p.map(t => (t.id === tid ? { ...t, progress: 100, status: 'completed' } : t)));
              transferMeta.delete(tid);
            }
          } catch (err) {
            console.error('[P2P] Transfer pump error:', err);
            setTransfers(p => p.map(t => (t.id === tid ? { ...t, status: 'error' } : t)));
          }
        };

        pump();
      } catch (err) {
        console.error('[P2P] onopen error:', err);
        setTransfers(p => p.map(t => (t.id === tid ? { ...t, status: 'error' } : t)));
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    sendRef.current({ type: 'webrtc_signaling', recipient_id: contactId, payload: { type: 'offer', payload: offer } });
    sendRef.current({ type: 'file_offer', recipient_id: contactId, file_info: { name: file.name, size: file.size, type: file.type, transfer_id: tid } });

    return tid;
  };

  // ── Accept an incoming file ──
  const acceptFile = async (peerId: string, transfer_id?: string) => {
    const pending = pendingSignals.get(peerId);
    if (!pending || pending.signal.type !== 'offer') { 
      console.warn('[P2P] No pending offer'); 
      if (transfer_id) {
        setTransfers(p => {
          if (p.find(t => t.id === transfer_id)) return p.map(t => t.id === transfer_id ? { ...t, status: 'error' } : t);
          return [...p, { id: transfer_id, name: 'File', size: 0, progress: 0, status: 'error', direction: 'receiving', peerId }];
        });
      }
      return; 
    }

    if (transfer_id) {
       setTransfers(p => {
         if (p.find(t => t.id === transfer_id)) return p.map(t => t.id === transfer_id ? { ...t, status: 'connecting' } : t);
         return [...p, { id: transfer_id, name: 'File', size: 0, progress: 0, status: 'connecting', direction: 'receiving', peerId }];
       });
    }

    console.log(`[P2P] Accepting from ${peerId}`);
    const pc = peerConnections.get(peerId);
    if (!pc) return;

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendRef.current({ type: 'webrtc_signaling', recipient_id: peerId, payload: { type: 'answer', payload: answer } });
    pendingSignals.delete(peerId);
    console.log('[P2P] Answer sent');
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
