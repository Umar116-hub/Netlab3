import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

// Using window.require because we configured contextIsolation: false in Electron
const ipcRenderer = (window as any).require ? (window as any).require('electron').ipcRenderer : null;

export interface DesktopMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  file_info?: {
    transfer_id: string;
    name: string;
    size: number;
    status?: string;
  };
}

export interface DesktopContact {
  id: string;
  name: string;
  ip: string;
  status: 'online' | 'offline';
  lastSeen: number;
  lastMessage?: string;
  unreadCount?: number;
}

export interface Transfer {
  id: string;
  peerId: string;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'active' | 'completed' | 'error' | 'paused' | 'cancelled';
  direction: 'sending' | 'receiving';
  ip?: string;
  port?: number;
  speed?: number;
  timeRemaining?: number;
}

interface DesktopNetContextType {
  myId: string;
  myName: string;
  contacts: DesktopContact[];
  messages: Record<string, DesktopMessage[]>;
  transfers: Transfer[];
  sendMessage: (toId: string, text: string) => Promise<boolean>;
  sendFile: (toId: string) => Promise<void>;
  sendFileOffer: (toId: string, fileObj: any) => Promise<void>;
  acceptFile: (transferId: string) => void;
  rejectFile: (transferId: string) => void;
  pauseTransfer: (transferId: string) => void;
  resumeTransfer: (transferId: string) => void;
  cancelTransfer: (transferId: string) => void;
  clearUnread: (contactId: string) => void;
}

const DesktopNetContext = createContext<DesktopNetContextType | null>(null);

export const DesktopNetProvider = ({ children }: { children: ReactNode }) => {
  const [myId, setMyId] = useState<string | null>(null);
  const [myName, setMyName] = useState<string>('Initializing...');
  const [contacts, setContacts] = useState<DesktopContact[]>([]);
  const [messages, setMessages] = useState<Record<string, DesktopMessage[]>>({});
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  // 1. Sync Hardware ID first
  useEffect(() => {
    if (ipcRenderer) {
      ipcRenderer.invoke('p2p:get-my-info').then((info: any) => {
        if (info && info.id) {
          setMyId(info.id);
          setMyName(info.name);
          localStorage.setItem('desktop_identity', info.id);
          localStorage.setItem('desktop_name', info.name);
        }
      });
    }
  }, []);

  // 2. Start signaling ONLY after ID is ready
  useEffect(() => {
    if (!ipcRenderer || !myId) return;

    ipcRenderer.invoke('p2p:renderer-ready');

    const handleSignaling = (_e: any, { fromIp, payload }: { fromIp: string, payload: any }) => {
      // Ignore our own loopback signals
      if (payload.from === myId) return;
      
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (payload.type === 'presence') {
        setContacts(prev => {
          const existing = prev.find(c => c.id === payload.id);
          if (existing) {
            return prev.map(c => c.id === payload.id ? { ...c, ip: fromIp, status: 'online', lastSeen: Date.now(), name: payload.name || c.name } : c);
          }
          return [...prev, { id: payload.id, name: payload.name || 'Unknown', ip: fromIp, status: 'online', lastSeen: Date.now(), unreadCount: 0 }];
        });
      } else if (payload.type === 'chat') {
        const senderId = payload.from;
        const msgId = `${Date.now()}-${Math.random()}`;

        setMessages(prev => {
           const existing = prev[senderId] || [];
           if (existing.find(m => m.text === payload.text && m.timestamp === timestamp)) return prev;
           return { ...prev, [senderId]: [...existing, { id: msgId, senderId, text: payload.text, timestamp }] };
        });

        setContacts(prev => prev.map(c => 
          c.id === senderId 
            ? { ...c, lastMessage: payload.text, unreadCount: (c.unreadCount ?? 0) + 1 } 
            : c
        ));
      } else if (payload.type === 'file_offer') {
        const senderId = payload.from;
        const newOffer: Transfer = {
          id: payload.transferId,
          peerId: senderId,
          name: payload.fileName,
          size: payload.fileSize,
          progress: 0,
          status: 'pending',
          direction: 'receiving',
          ip: fromIp,
          port: payload.port
        };

        setMessages(prev => {
           const existing = prev[senderId] || [];
           const fileMsg: DesktopMessage = {
             id: payload.transferId,
             senderId,
             text: '',
             timestamp,
             file_info: {
               transfer_id: payload.transferId,
               name: payload.fileName,
               size: payload.fileSize
             }
           };
           return { ...prev, [senderId]: [...existing, fileMsg] };
        });

        setTransfers(prev => {
          const existing = prev.find(t => t.id === payload.transferId);
          if (existing) return prev.map(t => t.id === payload.transferId ? { ...t, ...newOffer } : t);
          return [...prev, newOffer];
        });
      } else if (payload.type === 'transfer_paused') {
        setTransfers(prev => prev.map(t => t.id === payload.transferId ? { ...t, status: 'paused' } : t));
      } else if (payload.type === 'transfer_resumed') {
        setTransfers(prev => prev.map(t => t.id === payload.transferId ? { ...t, status: 'active' } : t));
      } else if (payload.type === 'transfer_cancelled') {
        setTransfers(prev => prev.map(t => t.id === payload.transferId ? { ...t, status: 'error' } : t));
      }
    };

    const handleProgress = (_e: any, progressEvent: any) => {
        setTransfers(prev => prev.map(t => t.id === progressEvent.transferId ? {
            ...t,
            progress: (progressEvent.bytesTransferred / progressEvent.totalBytes) * 100,
            status: progressEvent.status === 'completed' ? 'completed' : (progressEvent.status === 'error' ? 'error' : 'active'),
            speed: progressEvent.speed,
            timeRemaining: progressEvent.timeRemaining
        } : t));
    };

    ipcRenderer.on('p2p:receive-direct-signaling', handleSignaling);
    ipcRenderer.on('p2p:update-progress', handleProgress);

    return () => {
      ipcRenderer.removeListener('p2p:receive-direct-signaling', handleSignaling);
      ipcRenderer.removeListener('p2p:update-progress', handleProgress);
    };
  }, [myId]);

  const sendMessage = async (toId: string, text: string) => {
    const contact = contacts.find(c => c.id === toId);
    if (!contact || !ipcRenderer || !myId) return false;

    const payload = { type: 'chat', from: myId, text };
    try {
      const ok = await ipcRenderer.invoke('p2p:send-direct-signaling', { ip: contact.ip, port: 54546, payload });
      if (ok) {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setMessages(prev => ({
          ...prev,
          [toId]: [...(prev[toId] ?? []), { id: Date.now().toString(), senderId: 'me', text, timestamp }],
        }));
        setContacts(prev => prev.map(c => c.id === toId ? { ...c, lastMessage: text } : c));
      }
      return ok;
    } catch (e) {
      console.error("Failed to send direct message", e);
      return false;
    }
  };

  const clearUnread = (contactId: string) => {
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, unreadCount: 0 } : c));
  };

  const sendFileOffer = async (toId: string, fileObj: any) => {
     if (!ipcRenderer || !myId) return;
     const contact = contacts.find(c => c.id === toId);
     if (!contact) return;

     const transferId = `tx-${Date.now()}`;
     const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

     setMessages(prev => ({
       ...prev,
       [toId]: [...(prev[toId] ?? []), { 
         id: transferId, senderId: 'me', text: '', timestamp,
         file_info: { transfer_id: transferId, name: fileObj.name, size: fileObj.size }
       }],
     }));

     setTransfers(prev => [...prev, {
        id: transferId, peerId: toId, name: fileObj.name, size: fileObj.size, 
        progress: 0, status: 'pending', direction: 'sending', ip: contact.ip
     }]);

     const portInfo = await ipcRenderer.invoke('p2p:start-sender', { filePath: fileObj.path });
     
     if (portInfo && portInfo.port) {
        await ipcRenderer.invoke('p2p:send-direct-signaling', {
           ip: contact.ip, port: 54546, 
           payload: { type: 'file_offer', from: myId, transferId, fileName: fileObj.name, fileSize: fileObj.size, port: portInfo.port }
        });
     }
  };

  const sendFile = async (toId: string) => {
     if (!ipcRenderer) return;
     const fileObj = await ipcRenderer.invoke('p2p:select-file');
     if (fileObj) {
        await sendFileOffer(toId, fileObj);
     }
  };

  const acceptFile = (transferId: string) => {
     const t = transfers.find(x => x.id === transferId);
     if (!t || !ipcRenderer || !t.ip) return;

     ipcRenderer.send('p2p:get-save-path', t.name);
     
     const handleSavePath = (_e: any, savePath: string | null) => {
        if (savePath) {
           setTransfers(prev => prev.map(x => x.id === transferId ? { ...x, status: 'active' } : x));
           ipcRenderer.invoke('p2p:start-receiver', {
               senderIp: t.ip!,
               senderPort: (t as any).port || 54547,
               savePath: savePath,
               totalBytes: t.size,
               transferId: t.id
           });
        }
        ipcRenderer.removeListener('p2p:save-path-selected', handleSavePath);
     };
     ipcRenderer.on('p2p:save-path-selected', handleSavePath);
  };

  const rejectFile = (_transferId: string) => {};

  const pauseTransfer = (transferId: string) => {
    const t = transfers.find(x => x.id === transferId);
    if (!t || !ipcRenderer || !t.ip || !myId) return;
    ipcRenderer.invoke('p2p:pause-transfer');
    setTransfers(prev => prev.map(x => x.id === transferId ? { ...x, status: 'paused' } : x));
    ipcRenderer.invoke('p2p:send-direct-signaling', { 
      ip: t.ip, port: 54546, 
      payload: { type: 'transfer_paused', from: myId, transferId }
    });
  };

  const resumeTransfer = (transferId: string) => {
    const t = transfers.find(x => x.id === transferId);
    if (!t || !ipcRenderer || !t.ip || !myId) return;
    setTransfers(prev => prev.map(x => x.id === transferId ? { ...x, status: 'active' } : x));
    if (t.direction === 'sending') {
      ipcRenderer.invoke('p2p:send-direct-signaling', { 
        ip: t.ip, port: 54546, 
        payload: { type: 'transfer_resumed', from: myId, transferId }
      });
    } else {
      acceptFile(transferId);
    }
  };

  const cancelTransfer = (transferId: string) => {
    const t = transfers.find(x => x.id === transferId);
    if (!t || !ipcRenderer || !t.ip || !myId) return;
    ipcRenderer.invoke('p2p:cancel-transfer');
    setTransfers(prev => prev.map(x => x.id === transferId ? { ...x, status: 'error' } : x));
    ipcRenderer.invoke('p2p:send-direct-signaling', { 
      ip: t.ip, port: 54546, 
      payload: { type: 'transfer_cancelled', from: myId, transferId }
    });
  };

  return (
    <DesktopNetContext.Provider value={{ 
      myId: myId || 'Loading...', 
      myName: myName || 'User', 
      contacts, messages, transfers, sendMessage, sendFile, sendFileOffer, acceptFile, rejectFile, 
      pauseTransfer, resumeTransfer, cancelTransfer, clearUnread 
    }}>
      {children}
    </DesktopNetContext.Provider>
  );
};

export const useDesktopNet = () => {
    const ctx = useContext(DesktopNetContext);
    if (!ctx) throw new Error("useDesktopNet must be within DesktopNetProvider");
    return ctx;
};
