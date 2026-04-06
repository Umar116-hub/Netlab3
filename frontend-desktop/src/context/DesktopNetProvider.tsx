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
  status: 'pending' | 'active' | 'completed' | 'error';
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
        setTransfers(prev => [...prev, {
          id: payload.transferId,
          peerId: payload.from,
          name: payload.fileName,
          size: payload.fileSize,
          progress: 0,
          status: 'pending',
          direction: 'receiving',
          ip: fromIp
        }]);
      }
    };

    const handleProgress = (_e: any, progressEvent: any) => {
        setTransfers(prev => prev.map(t => t.id === progressEvent.transferId ? {
            ...t,
            progress: progressEvent.progress,
            status: progressEvent.progress >= 100 ? 'completed' : 'active'
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

     // Send offer to receiver via signaling server
     const ok = await ipcRenderer.invoke('p2p:send-direct-signaling', {
         ip: contact.ip, port: 54546, 
         payload: { type: 'file_offer', from: myId, transferId, fileName: fileObj.name, fileSize: fileObj.size }
     });

     if (ok) {
        // Only start the file sender server if the offer was successfully signaled
        ipcRenderer.invoke('p2p:start-sender', { filePath: fileObj.path });
     }
  };

  const acceptFile = (transferId: string) => {
     const t = transfers.find(x => x.id === transferId);
     if (!t || !ipcRenderer || !t.ip) return;

     setTransfers(prev => prev.map(x => x.id === transferId ? { ...x, status: 'active' } : x));
     ipcRenderer.invoke('p2p:start-receiver', {
         senderIp: t.ip,
         senderPort: 54547, // Default Desktop file transfer port from FileSender
         fileName: t.name,
         totalBytes: t.size,
         transferId: t.id
     });
  };

  const rejectFile = (_transferId: string) => {};

  return (
    <DesktopNetContext.Provider value={{ 
      myId, myName, contacts, messages, transfers, sendMessage, sendFile, acceptFile, rejectFile, clearUnread 
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
