import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

// Using window.require because we configured contextIsolation: false in Electron
const ipcRenderer = (window as any).require ? (window as any).require('electron').ipcRenderer : null;

export interface DesktopMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
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
}

interface DesktopNetContextType {
  myId: string;
  myName: string;
  contacts: DesktopContact[];
  messages: Record<string, DesktopMessage[]>;
  transfers: Transfer[];
  sendMessage: (toId: string, text: string) => Promise<boolean>;
  sendFile: (toId: string) => Promise<void>;
  acceptFile: (transferId: string) => void;
  rejectFile: (transferId: string) => void;
  pauseTransfer: (transferId: string) => void;
  resumeTransfer: (transferId: string) => void;
  cancelTransfer: (transferId: string) => void;
  clearUnread: (contactId: string) => void;
}

const DesktopNetContext = createContext<DesktopNetContextType | null>(null);

export const DesktopNetProvider = ({ children }: { children: ReactNode }) => {
  const [myId] = useState(() => localStorage.getItem('desktop_identity') || `mac-${Math.random().toString(36).substring(7)}`);
  const [myName, _setMyName] = useState(() => localStorage.getItem('desktop_name') || `User-${Math.floor(Math.random() * 1000)}`);
  const [contacts, setContacts] = useState<DesktopContact[]>([]);
  const [messages, setMessages] = useState<Record<string, DesktopMessage[]>>({});
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  // Storing initial state permanently
  useEffect(() => {
    localStorage.setItem('desktop_identity', myId);
    localStorage.setItem('desktop_name', myName);
  }, [myId, myName]);

  useEffect(() => {
    if (!ipcRenderer) {
      console.warn("Not running inside Electron! IPC is disabled.");
      return;
    }

    // Signal main process that we are ready to receive buffered messages
    ipcRenderer.invoke('p2p:renderer-ready');

    // Ping LAN for presence 
    // Format: { type: 'presence', id, name }
    
    // Listen for direct UDP/TCP signaling
    const handleSignaling = (_e: any, { fromIp, payload }: { fromIp: string, payload: any }) => {
      console.log("[P2P] Received direct signaling:", payload);
      
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
        const newMsg: DesktopMessage = {
          id: Date.now().toString(),
          senderId,
          text: payload.text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        
        setMessages(prev => ({
          ...prev,
          [senderId]: [...(prev[senderId] ?? []), newMsg],
        }));

        setContacts(prev => prev.map(c => 
          c.id === senderId 
            ? { ...c, lastMessage: payload.text, unreadCount: (c.unreadCount ?? 0) + 1 } 
            : c
        ));
      } else if (payload.type === 'file_offer') {
        const newOffer = {
          id: payload.transferId,
          peerId: payload.from,
          name: payload.fileName,
          size: payload.fileSize,
          progress: 0,
          status: 'pending' as const,
          direction: 'receiving' as const,
          ip: fromIp,
          port: payload.port
        };
        setTransfers(prev => {
          const existing = prev.find(t => t.id === payload.transferId);
          if (existing) {
            return prev.map(t => t.id === payload.transferId ? { ...t, ...newOffer } : t);
          }
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
            status: progressEvent.status === 'completed' ? 'completed' : (progressEvent.status === 'error' ? 'error' : 'active')
        } : t));
    };

    ipcRenderer.on('p2p:receive-direct-signaling', handleSignaling);
    ipcRenderer.on('p2p:update-progress', handleProgress);

    return () => {
      ipcRenderer.removeListener('p2p:receive-direct-signaling', handleSignaling);
      ipcRenderer.removeListener('p2p:update-progress', handleProgress);
    };
  }, []);

  const sendMessage = async (toId: string, text: string) => {
    const contact = contacts.find(c => c.id === toId);
    if (!contact || !ipcRenderer) return false;

    // Send direct TCP message via main.ts
    const payload = { type: 'chat', from: myId, text };
    try {
      const ok = await ipcRenderer.invoke('p2p:send-direct-signaling', { ip: contact.ip, port: 54546, payload });
      if (ok) {
        const newMsg: DesktopMessage = {
          id: Date.now().toString(),
          senderId: 'me',
          text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages(prev => ({
          ...prev,
          [toId]: [...(prev[toId] ?? []), newMsg],
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

  const sendFile = async (toId: string) => {
     if (!ipcRenderer) return;
     const contact = contacts.find(c => c.id === toId);
     if (!contact) return;

     const fileObj = await ipcRenderer.invoke('p2p:select-file');
     if (!fileObj) return;

     const transferId = `tx-${Date.now()}`;
     
     setTransfers(prev => [...prev, {
        id: transferId, peerId: toId, name: fileObj.name, size: fileObj.size, 
        progress: 0, status: 'pending', direction: 'sending'
     }]);

     // Start the file sender and get the ACTUAL dynamic port
     const portInfo = await ipcRenderer.invoke('p2p:start-sender', { filePath: fileObj.path });
     
     if (portInfo && portInfo.port) {
        // NOW send the single offer with the correct port
        await ipcRenderer.invoke('p2p:send-direct-signaling', {
           ip: contact.ip, port: 54546, 
           payload: { type: 'file_offer', from: myId, transferId, fileName: fileObj.name, fileSize: fileObj.size, port: portInfo.port }
        });
     }
  };

  const acceptFile = (transferId: string) => {
     const t = transfers.find(x => x.id === transferId);
     if (!t || !ipcRenderer || !t.ip) return;

     setTransfers(prev => prev.map(x => x.id === transferId ? { ...x, status: 'active' } : x));
     ipcRenderer.invoke('p2p:start-receiver', {
         senderIp: t.ip,
         senderPort: (t as any).port || 54547, // Use the dynamic port from the signal
         fileName: t.name,
         totalBytes: t.size,
         transferId: t.id
     });
  };

  const rejectFile = (_transferId: string) => {};

  const pauseTransfer = (transferId: string) => {
    const t = transfers.find(x => x.id === transferId);
    if (!t || !ipcRenderer || !t.ip) return;
    ipcRenderer.invoke('p2p:pause-transfer');
    setTransfers(prev => prev.map(x => x.id === transferId ? { ...x, status: 'paused' } : x));
    // Signal peer
    ipcRenderer.invoke('p2p:send-direct-signaling', { 
      ip: t.ip, port: 54546, 
      payload: { type: 'transfer_paused', transferId }
    });
  };

  const resumeTransfer = (transferId: string) => {
    const t = transfers.find(x => x.id === transferId);
    if (!t || !ipcRenderer || !t.ip) return;
    
    setTransfers(prev => prev.map(x => x.id === transferId ? { ...x, status: 'active' } : x));
    
    if (t.direction === 'sending') {
      // Re-start sender (FileSender handles the offset internally now)
      // We'd need to re-invoke something or just let the receiver reconnect.
      // For simplicity, usually, the receiver initiates reconnection.
      ipcRenderer.invoke('p2p:send-direct-signaling', { 
        ip: t.ip, port: 54546, 
        payload: { type: 'transfer_resumed', transferId }
      });
    } else {
      // Receiver connects again
      acceptFile(transferId);
    }
  };

  const cancelTransfer = (transferId: string) => {
    const t = transfers.find(x => x.id === transferId);
    if (!t || !ipcRenderer || !t.ip) return;
    ipcRenderer.invoke('p2p:cancel-transfer');
    setTransfers(prev => prev.map(x => x.id === transferId ? { ...x, status: 'error' } : x));
    ipcRenderer.invoke('p2p:send-direct-signaling', { 
      ip: t.ip, port: 54546, 
      payload: { type: 'transfer_cancelled', transferId }
    });
  };

  return (
    <DesktopNetContext.Provider value={{ 
      myId, myName, contacts, messages, transfers, sendMessage, sendFile, acceptFile, rejectFile, 
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
