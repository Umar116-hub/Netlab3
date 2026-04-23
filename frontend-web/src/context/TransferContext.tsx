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
  status: 'pending' | 'connecting' | 'active' | 'paused' | 'completed' | 'error' | 'cancelled';
  direction: 'sending' | 'receiving';
  peerId: string;
  speed?: number;
  timeRemaining?: number;
  pausedBy?: string; // Account ID of the person who paused it
}

interface TransferContextValue {
  transfers: ActiveTransfer[];
  sendFile: (contactId: string, file: File) => Promise<string>;
  acceptFile: (peerId: string, transfer_id?: string) => Promise<void>;
  cancelTransfer: (transferId: string, peerId: string) => void;
  pauseTransfer: (transferId: string) => void;
  resumeTransfer: (transferId: string) => void;
}

const TransferContext = createContext<TransferContextValue | null>(null);

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

export function TransferProvider({ children }: { children: ReactNode }) {
  const { send, addListener, removeListener, myIp } = useWebSocket();
  const [transfers, setTransfers] = useState<ActiveTransfer[]>([]);

  // Use refs for mutable maps — they survive re-renders without causing effect re-runs
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map()).current;
  const pendingSignals = useRef<Map<string, { peerId: string; signal: any }>>(new Map()).current;
  const candidateQueue = useRef<Map<string, RTCIceCandidateInit[]>>(new Map()).current;
  const transferMeta = useRef<Map<string, { startTime: number; lastBytes: number; lastTime: number }>>(new Map()).current;
  const fileStreams = useRef<Map<string, FileSystemWritableFileStream>>(new Map()).current;
  // Pause flags: transferId -> true means paused
  const pauseFlags = useRef<Map<string, boolean>>(new Map()).current;
  // Resume callbacks: transferId -> function to call when resuming
  const resumeCallbacks = useRef<Map<string, () => void>>(new Map()).current;
  // Active DataChannels: transferId -> RTCDataChannel
  const dataChannels = useRef<Map<string, RTCDataChannel>>(new Map()).current;
  // Wake Lock Ref
  const wakeLock = useRef<any>(null);

  // Keep `send` in a ref so callbacks always use the latest version
  const sendRef = useRef(send);
  sendRef.current = send;

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator && !wakeLock.current) {
      try {
        wakeLock.current = await (navigator as any).wakeLock.request('screen');
        console.log('%c[P2P] ⚡ Screen Wake Lock Acquired', 'color:#ffeb3b;font-weight:bold');
        wakeLock.current.addEventListener('release', () => {
          console.log('[P2P] Screen Wake Lock Released');
          wakeLock.current = null;
        });
      } catch (err: any) {
        console.warn(`[P2P] Wake Lock Failed: ${err.message}`);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLock.current) {
      await wakeLock.current.release();
      wakeLock.current = null;
    }
  };

  // ── Wake Lock Manager — monitors active transfers and visibility ──
  useEffect(() => {
    const hasActive = transfers.some(t => ['connecting', 'active'].includes(t.status));
    
    if (hasActive) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && hasActive) {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      releaseWakeLock();
    };
  }, [transfers]);

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
        const fromId = msg.from || msg.sender_id;
        console.log(`[P2P] File offer: "${o.file_info.name}" from ${fromId}`);
        if (!fromId) return;
        
        setTransfers(prev => {
          if (prev.some(t => t.id === o.file_info.transfer_id)) return prev;
          return [...prev, {
            id: o.file_info.transfer_id, name: o.file_info.name,
            size: o.file_info.size, progress: 0, status: 'pending' as const,
            direction: 'receiving' as const, peerId: fromId,
          }];
        });
      } else if (msg.type === 'file_pause') {
        console.log(`[P2P] Remote paused transfer ${msg.transfer_id}`);
        pauseFlags.set(msg.transfer_id, true);
        setTransfers(p => p.map(t => (t.id === msg.transfer_id ? { ...t, status: 'paused', speed: 0, timeRemaining: -1, pausedBy: 'peer' } : t)));
      } else if (msg.type === 'file_resume') {
        console.log(`[P2P] Remote resumed transfer ${msg.transfer_id}`);
        pauseFlags.set(msg.transfer_id, false);
        setTransfers(p => p.map(t => (t.id === msg.transfer_id ? { ...t, status: 'active', speed: 0, pausedBy: undefined } : t)));
        const cb = resumeCallbacks.get(msg.transfer_id);
        if (cb) cb();
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

      // mDNS bypass - Prioritize detected IP from server, then fallback to current location
      const isLoopback = myIp === '127.0.0.1' || myIp === '::1' || myIp === 'localhost';
      const host = (myIp && !isLoopback) ? myIp : window.location.hostname;
      
      if (ip.endsWith('.local') && (myIp || /^(\d{1,3}\.){3}\d{1,3}$/.test(host))) {
        if (host === 'localhost' || host === '127.0.0.1') {
           // Skip replacement if we still only have localhost - others can't connect to it
           return;
        }
        sendRef.current({
          type: 'webrtc_signaling', recipient_id: peerId,
          payload: { type: 'candidate', payload: { candidate: e.candidate.candidate.replace(ip, host), sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } },
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`%c[P2P] ICE: ${pc.iceConnectionState}`, 'color:#ff9800;font-weight:bold');
      if (pc.iceConnectionState === 'failed') {
        setTransfers(p => p.map(t => {
          if (t.peerId === peerId && ['connecting', 'active'].includes(t.status)) {
            console.log(`[P2P] ⚠️ Reporting ICE Error for ${t.id}`);
            api.updateFileStatus(t.id, 'error', peerId).catch(console.error);
            return { ...t, status: 'error' };
          }
          return t;
        }));
      }
    };
    pc.onconnectionstatechange = () => {
      console.log(`%c[P2P] Conn: ${pc.connectionState}`, 'color:#00bcd4;font-weight:bold');
      if (pc.connectionState === 'failed') {
        setTransfers(p => p.map(t => {
          if (t.peerId === peerId && ['connecting', 'active'].includes(t.status)) {
            console.log(`[P2P] ⚠️ Reporting Conn Error for ${t.id}`);
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
    let lastReport = Date.now();
    let currentChunkBytes = 0;
    let blobParts: Blob[] = [];
    let stream: FileSystemWritableFileStream | null = null;

    const finalizeTransfer = async () => {
      console.log(`%c[P2P] ✅ Received ${got} bytes`, 'color:#4CAF50;font-weight:bold');
      
      // 1. IMMEDIATELY lock the 'completed' status so it can't be overwritten!
      setTransfers(p => p.map(t => (t.id === tid ? { ...t, progress: 100, status: 'completed' as const, speed: 0, timeRemaining: 0 } : t)));
      if (tid) {
        console.log(`[P2P] ✅ Reporting Completion for ${tid}`);
        api.updateFileStatus(tid, 'completed', peerId).catch(console.error);
      }

      // 2. Then proceed with the slower disk closure / blob creation logic
      if (stream) {
        // Fast path: disk stream was pre-acquired via showSaveFilePicker
        try { await stream.close(); } catch (e) { console.error('[P2P] Stream close error:', e); }
      } else {
        if (chunks.length > 0) blobParts.push(new Blob(chunks));
        const finalBlob = new Blob(blobParts);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(finalBlob);
        a.download = fname;
        a.click();
      }
      
      chunks = [];
      blobParts = [];
      got = 0;
      currentChunkBytes = 0;
    };

    ch.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const m = JSON.parse(ev.data);
        if (m.type === 'file_meta') {
          console.log(`[P2P] Receiving "${m.name}" (${m.size} bytes)`);
          tid = m.transfer_id;
          if (tid) dataChannels.set(tid, ch); // Track receiver's end
          total = m.size; fname = m.name;

          // Pick up a pre-acquired disk stream if available
          if (tid && fileStreams.has(tid)) {
            stream = fileStreams.get(tid)!;
            fileStreams.delete(tid);
          }

          setTransfers(p => {
            const existing = p.find(t => t.id === m.transfer_id);
            if (existing) return p.map(t => (t.id === m.transfer_id ? { ...t, status: 'active' as const } : t));
            return [...p, { id: m.transfer_id, name: m.name, size: m.size, progress: 0, status: 'active', direction: 'receiving', peerId }];
          });
        } else if (m.type === 'PAUSE') {
          console.log(`[P2P] Remote paused transfer ${tid}`);
          setTransfers(p => p.map(t => (t.id === tid ? { ...t, status: 'paused', speed: 0, timeRemaining: -1, pausedBy: 'peer' } : t)));
        } else if (m.type === 'RESUME') {
          console.log(`[P2P] Remote resumed transfer ${tid}`);
          setTransfers(p => p.map(t => (t.id === tid ? { ...t, status: 'active', speed: 0, pausedBy: undefined } : t)));
        }
        return;
      }
      
      const buf = ev.data as ArrayBuffer;
      got += buf.byteLength;
      currentChunkBytes += buf.byteLength;

      if (stream) {
        // True zero-RAM disk write
        stream.write(buf).catch((e: Error) => {
          console.error('[P2P] Disk write error:', e);
          ch.close();
        });
      } else {
        // Blob Chunking fallback: spill every 10MB to reduce RAM (safer for mobile)
        chunks.push(buf);
        if (currentChunkBytes >= 10 * 1024 * 1024) {
          blobParts.push(new Blob(chunks));
          chunks = [];
          currentChunkBytes = 0;
        }
      }

      if (got >= total) {
         finalizeTransfer();
      }

      if (!tid || total <= 0) return;
      const pct = Math.floor((got / total) * 100);

      const now = Date.now();
      if (now - lastReport > 500 && got < total) {
        lastReport = now;
        setTransfers(p => p.map(t => (t.id === tid ? { ...t, progress: pct } : t)));
        updateTransferMetrics(tid, got, total);
      }
    };
    ch.onerror = (e) => {
      console.error('[P2P] Receiver channel error:', e);
      if (tid) {
        setTransfers(p => p.map(t => {
          if (t.id === tid && ['connecting', 'active'].includes(t.status)) {
            console.log(`[P2P] ⚠️ Reporting Channel Error (Receiver) for ${tid}`);
            api.updateFileStatus(tid, 'error', peerId).catch(console.error);
            return { ...t, status: 'error' };
          }
          return t;
        }));
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
    dataChannels.set(tid, ch);

    ch.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const ctrl = JSON.parse(ev.data);
          if (ctrl.type === 'PAUSE') {
            console.log(`[P2P] Received direct PAUSE for ${tid}`);
            pauseFlags.set(tid, true);
            setTransfers(p => p.map(t => (t.id === tid ? { ...t, status: 'paused', speed: 0, timeRemaining: -1, pausedBy: 'peer' } : t)));
          } else if (ctrl.type === 'RESUME') {
            console.log(`[P2P] Received direct RESUME for ${tid}`);
            pauseFlags.set(tid, false);
            setTransfers(p => p.map(t => (t.id === tid ? { ...t, status: 'active', speed: 0, pausedBy: undefined } : t)));
            const cb = resumeCallbacks.get(tid);
            if (cb) cb();
          }
        } catch {}
      }
    };

    ch.onerror = (e) => {
      console.error('[P2P] Sender channel error:', e);
      setTransfers(p => p.map(t => {
        if (t.id === tid && ['connecting', 'active', 'pending'].includes(t.status)) {
          console.log(`[P2P] ⚠️ Reporting Channel Error (Sender) for ${tid}`);
          api.updateFileStatus(tid, 'error', contactId).catch(console.error);
          return { ...t, status: 'error' };
        }
        return t;
      }));
      dataChannels.delete(tid);
    };

    ch.onopen = () => {
      console.log(`%c[P2P] ✅ DataChannel OPEN — sending "${file.name}"`, 'color:#4CAF50;font-weight:bold');
      try {
        ch.send(JSON.stringify({ type: 'file_meta', name: file.name, size: file.size, transfer_id: tid }));

        const CHUNK = 262144; // 256KB
        const BULK_SIZE = 4 * 1024 * 1024; // 4MB bulk read
        const MAX_BUFFER = 8 * 1024 * 1024; // 8MB WebRTC buffer max
        let offset = 0;
        let sentBytes = 0;
        let lastReport = Date.now();
        let nextChunkPromise: Promise<ArrayBuffer> | null = null;
        let isPumping = false;

        setTransfers(p => p.map(t => (t.id === tid ? { ...t, status: 'active' } : t)));

        const getNextChunk = () => {
          const end = Math.min(offset + BULK_SIZE, file.size);
          const p = file.slice(offset, end).arrayBuffer();
          offset = end;
          return p;
        };

        const pump = async () => {
          if (isPumping || ch.readyState !== 'open') return;
          if (pauseFlags.get(tid)) return; // Paused — do nothing until resumed
          isPumping = true;

          try {
            while (sentBytes < file.size) {
              if (ch.bufferedAmount >= MAX_BUFFER) {
                break; // Stop and let the network drain
              }

              // Check if paused mid-loop
              if (pauseFlags.get(tid)) {
                break;
              }

              // Pre-fetch the initial chunk if haven't already
              if (!nextChunkPromise && offset < file.size) {
                nextChunkPromise = getNextChunk();
              }

              if (nextChunkPromise) {
                const buffer = await nextChunkPromise;
                nextChunkPromise = null;

                // IMMEDIATELY pre-fetch the next chunk before interacting with WebRTC
                if (offset < file.size) {
                  nextChunkPromise = getNextChunk();
                }

                if (ch.readyState !== 'open') break;

                // Fire the current chunk into the WebRTC stack (zero-copy)
                for (let i = 0; i < buffer.byteLength; i += CHUNK) {
                  const chunkLen = Math.min(CHUNK, buffer.byteLength - i);
                  ch.send(new Uint8Array(buffer, i, chunkLen));
                }
                
                sentBytes += buffer.byteLength;

                const now = Date.now();
                if (now - lastReport > 500 || sentBytes >= file.size) {
                  const pct = Math.floor((sentBytes / file.size) * 100);
                  updateTransferMetrics(tid, sentBytes, file.size);
                  lastReport = now;
                  setTransfers(p => p.map(t => (t.id === tid ? { ...t, progress: pct, status: sentBytes >= file.size ? 'completed' : 'active' } : t)));
                }
              }
            }

            if (sentBytes >= file.size) {
              console.log(`%c[P2P] ✅ Sent all ${file.size} bytes`, 'color:#4CAF50;font-weight:bold');
              // 1. Lock completion immediately
              setTransfers(p => p.map(t => (t.id === tid ? { ...t, progress: 100, status: 'completed' } : t)));
              console.log(`[P2P] ✅ Reporting Completion (Sender) for ${tid}`);
              api.updateFileStatus(tid, 'completed', contactId).catch(console.error);

              // 2. Clean up
              transferMeta.delete(tid);
              pauseFlags.delete(tid);
              resumeCallbacks.delete(tid);
              dataChannels.delete(tid);
            }
          } catch (err) {
            console.error('[P2P] Transfer pump error:', err);
            setTransfers(p => p.map(t => (t.id === tid ? { ...t, status: 'error' } : t)));
            api.updateFileStatus(tid, 'error', contactId).catch(console.error);
            transferMeta.delete(tid);
            pauseFlags.delete(tid);
            resumeCallbacks.delete(tid);
            dataChannels.delete(tid);
          } finally {
            isPumping = false;
          }
        };

        // Network tells us when the buffer drains to 4MB, instantly resuming the pump
        ch.onbufferedamountlow = () => {
          if (!pauseFlags.get(tid)) pump();
        };
        ch.bufferedAmountLowThreshold = 4 * 1024 * 1024;

        // Store a resume callback so pauseTransfer/resumeTransfer can re-trigger pump
        resumeCallbacks.set(tid, pump);
        pauseFlags.set(tid, false);

        pump(); // Initial start
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
      // Find the name from the transfers list
      const existingTransfer = transfers.find(t => t.id === transfer_id);
      const suggestedName = existingTransfer?.name || 'file';

      // Try to open a Save dialog for true disk-streaming
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: suggestedName,
          });
          const writableStream = await handle.createWritable();
          fileStreams.set(transfer_id, writableStream);
          console.log('[P2P] ✅ Disk stream acquired for', suggestedName);
        } catch (err: any) {
          if (err.name === 'AbortError') {
            console.log('[P2P] User cancelled Save dialog');
            return; // Don't start transfer if user cancelled
          }
          console.warn('[P2P] showSaveFilePicker failed, falling back to Blob:', err.message);
        }
      } else {
        console.log('[P2P] showSaveFilePicker not available, using Blob Chunking fallback');
      }

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

  // ── Cancel a transfer ──
  const cancelTransfer = (transferId: string, peerId: string) => {
    console.log(`[P2P] Cancelling transfer ${transferId}`);
    
    // 1. Report Cancellation to server FIRST
    console.log(`[P2P] ✕ Reporting Cancellation for ${transferId}`);
    api.updateFileStatus(transferId, 'cancelled', peerId).catch(console.error);
    
    // 2. Update local state
    setTransfers(p => p.map(t => (t.id === transferId ? { ...t, status: 'cancelled' } : t)));

    // 3. Close the peer connection ONLY AFTER reporting the status
    const pc = peerConnections.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.delete(peerId);
    }
    
    transferMeta.delete(transferId);
    pauseFlags.delete(transferId);
    resumeCallbacks.delete(transferId);
    dataChannels.delete(transferId);
  };

  // ── Pause a transfer ──
  const pauseTransfer = (transferId: string) => {
    console.log(`[P2P] Pausing transfer ${transferId}`);
    pauseFlags.set(transferId, true);
    const transfer = transfers.find(t => t.id === transferId);
    if (transfer) {
      // 1. Direct P2P Pause (Instant)
      const ch = dataChannels.get(transferId);
      if (ch && ch.readyState === 'open') {
        try { ch.send(JSON.stringify({ type: 'PAUSE' })); } catch {}
      }
      // 2. WebSocket Fallback
      sendRef.current({ type: 'file_pause', recipient_id: transfer.peerId, transfer_id: transferId });
    }
    setTransfers(p => p.map(t => (t.id === transferId && t.status === 'active' ? { ...t, status: 'paused', speed: 0, timeRemaining: -1, pausedBy: 'me' } : t)));
  };

  // ── Resume a transfer ──
  const resumeTransfer = (transferId: string) => {
    console.log(`[P2P] Resuming transfer ${transferId}`);
    pauseFlags.set(transferId, false);
    const transfer = transfers.find(t => t.id === transferId);
    if (transfer) {
      // 1. Direct P2P Resume (Instant)
      const ch = dataChannels.get(transferId);
      if (ch && ch.readyState === 'open') {
        try { ch.send(JSON.stringify({ type: 'RESUME' })); } catch {}
      }
      // 2. WebSocket Fallback
      sendRef.current({ type: 'file_resume', recipient_id: transfer.peerId, transfer_id: transferId });
    }
    setTransfers(p => p.map(t => (t.id === transferId && t.status === 'paused' ? { ...t, status: 'active', speed: 0, pausedBy: undefined } : t)));
    const cb = resumeCallbacks.get(transferId);
    if (cb) cb(); // Kick the pump back into action
  };

  return (
    <TransferContext.Provider value={{ transfers, sendFile, acceptFile, cancelTransfer, pauseTransfer, resumeTransfer }}>
      {children}
    </TransferContext.Provider>
  );
}

export function useTransfer() {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error('useTransfer must be inside <TransferProvider>');
  return ctx;
}
