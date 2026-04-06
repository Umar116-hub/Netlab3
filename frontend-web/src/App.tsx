import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth, useWebSocket } from './context/AuthContext';
import { api } from './lib/api';
import AuthPage from './pages/AuthPage';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';

export interface Contact {
  id: string;
  name: string;
  status: 'online' | 'offline';
  lastMessage?: string;
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  file_info?: {
    transfer_id: string;
    name: string;
    size: number;
    type: string;
    status?: string;
  };
  rawTime?: number;
}

function ChatApp() {
  const { accountId, username, logout } = useAuth();
  const { isConnected, send, addListener, removeListener, setOnlineUserIds } = useWebSocket();

  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const activeContactRef = useRef(activeContactId);
  useEffect(() => {
    activeContactRef.current = activeContactId;
  }, [activeContactId]);

  // Handle incoming WS messages via listener
  useEffect(() => {
    const handleMessage = (msg: any) => {
      if (msg.type === 'chat_message' && msg.from) {
        const senderId = msg.from;
        const rawTime = Date.now();
        const newMsg: Message = {
          id: rawTime.toString(),
          senderId,
          text: msg.text ?? '',
          timestamp: new Date().toISOString(),
          rawTime,
          file_info: msg.file_info,
        };
        setMessages(prev => ({
          ...prev,
          [senderId]: [...(prev[senderId] ?? []), newMsg],
        }));
        
        if (senderId !== activeContactRef.current) {
          setUnreadCounts(prev => ({ ...prev, [senderId]: (prev[senderId] ?? 0) + 1 }));
        } else {
          localStorage.setItem(`last_read_${accountId}_${senderId}`, rawTime.toString());
        }
      } else if (msg.type === 'file_offer' && msg.from) {
        // Receiver sees the file offer bubble in real time (online case)
        const senderId = msg.from;
        const rawTime = Date.now();
        const newMsg: Message = {
          id: rawTime.toString(),
          senderId,
          text: '',
          timestamp: new Date().toISOString(),
          rawTime,
          file_info: { ...msg.file_info, status: 'pending' },
        };
        setMessages(prev => {
          const existing = prev[senderId] ?? [];
          // Avoid duplicates if history was already loaded
          if (existing.some(m => m.file_info?.transfer_id === msg.file_info?.transfer_id)) return prev;
          return { ...prev, [senderId]: [...existing, newMsg] };
        });
        if (senderId !== activeContactRef.current) {
          setUnreadCounts(prev => ({ ...prev, [senderId]: (prev[senderId] ?? 0) + 1 }));
        }
      } else if (msg.type === 'update_file_status') {
        // Update file status in the message list for both sender/receiver
        const peerId = msg.from; // the one who updated (receiver)
        setMessages(prev => {
          const next = { ...prev };
          if (next[peerId]) {
            next[peerId] = next[peerId].map(m =>
              m.file_info?.transfer_id === msg.transfer_id
                ? { ...m, file_info: { ...m.file_info, status: msg.status } as any }
                : m
            );
          }
          return next;
        });
      }
    };

    addListener(handleMessage);
    return () => removeListener(handleMessage);
  }, [addListener, removeListener]);

  // Fetch real contacts on load
  const fetchContacts = useCallback(() => {
    console.log(`[Discovery] Fetching contacts for ${username}...`);
    api.getDiscoveryContacts().then(allUsers => {
      const filtered = allUsers.filter(u => u.name !== username);
      setContacts(filtered);
    }).catch(err => {
      console.error('[Discovery] Failed to fetch contacts:', err);
    });
  }, [username]);

  // Full refresh: contacts + online status
  const handleRefresh = useCallback(() => {
    fetchContacts();
    api.getOnlineUsers().then(users => {
      setOnlineUserIds(new Set(users.map((u: any) => u.id)));
    }).catch(console.error);
  }, [fetchContacts, setOnlineUserIds]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Fetch message history for all contacts to determine unread counts and pre-populate chat
  useEffect(() => {
    if (!accountId || contacts.length === 0) return;

    contacts.forEach(contact => {
      const conversationId = [accountId, contact.id].sort().join(':');
      
      api.getMessages(conversationId).then(res => {
        const historyMsgs = res.messages.map(m => {
          const isoStr = m.timestamp.includes('Z') ? m.timestamp : m.timestamp.replace(' ', 'T') + 'Z';
          return {
            id: m.id,
            senderId: m.sender_account_id === accountId ? 'me' : m.sender_account_id,
            text: m.text,
            timestamp: new Date(isoStr).toISOString(),
            rawTime: new Date(isoStr).getTime(),
            file_info: m.file_info
          };
        });

        setMessages(prev => ({ ...prev, [contact.id]: historyMsgs }));

        const lastRead = parseInt(localStorage.getItem(`last_read_${accountId}_${contact.id}`) || '0', 10);
        
        // Count messages strictly sent by the OTHER person that are newer than lastRead
        const unread = historyMsgs.filter(m => m.senderId !== 'me' && (m.rawTime || 0) > lastRead).length;

        if (unread > 0 && activeContactRef.current !== contact.id) {
          setUnreadCounts(prev => ({ ...prev, [contact.id]: unread }));
        }
      }).catch(err => console.error('[History] Failed to fetch:', err));
    });
  }, [contacts, accountId]);
  const handleSendMessage = (text: string) => {
    if (!activeContactId) return;

    const newMsg: Message = {
      id: Date.now().toString(),
      senderId: 'me',
      text,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => ({
      ...prev,
      [activeContactId]: [...(prev[activeContactId] ?? []), newMsg],
    }));

    // Send over WebSocket if connected
    send({ type: 'chat_message', to: activeContactId, text });
  };

  const handleLocalFileSent = async (contactId: string, file_info: any) => {
    const newMsg: Message = {
      id: Date.now().toString(),
      senderId: 'me',
      text: '',
      timestamp: new Date().toISOString(),
      file_info: { ...file_info, status: 'pending' }
    };

    setMessages(prev => ({
      ...prev,
      [contactId]: [...(prev[contactId] ?? []), newMsg],
    }));

    // Persist to DB via HTTP (reliable) — backend also notifies recipient via WS
    try {
      await api.saveFileOffer(contactId, file_info);
    } catch (err) {
      console.error('[FileOffer] Failed to persist offer:', err);
    }
  };

  const handleSelectContact = (id: string | null) => {
    setActiveContactId(id);
    if (id) {
      setUnreadCounts(prev => ({ ...prev, [id]: 0 }));
      localStorage.setItem(`last_read_${accountId}_${id}`, Date.now().toString());
    }
  };

  const activeContact = contacts.find(c => c.id === activeContactId) ?? null;
  const activeMessages = activeContactId ? (messages[activeContactId] ?? []) : [];

  return (
    <div className="layout-container" data-active={!!activeContactId ? 'true' : 'false'}>
      {/* Connection status badge */}
      <div className={`ws-status ${isConnected ? 'connected' : 'disconnected'}`}>
        {isConnected ? '● Connected' : '○ Offline'}
      </div>

      <Sidebar
        contacts={contacts}
        activeContactId={activeContactId}
        onSelectContact={handleSelectContact}
        currentUser={username ?? 'You'}
        unreadCounts={unreadCounts}
        onLogout={logout}
        onRefresh={handleRefresh}
      />
      <ChatArea
        contact={activeContact}
        messages={activeMessages}
        onSendMessage={handleSendMessage}
        onLocalFileSent={handleLocalFileSent}
        onBack={() => handleSelectContact(null)}
      />
    </div>
  );
}

function App() {
  const { token } = useAuth();
  return token ? <ChatApp /> : <AuthPage />;
}

export default App;
