import { useState, useEffect } from 'react';
import { useAuth, useWebSocket } from './context/AuthContext';
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
}

import { api } from './lib/api';

function ChatApp() {
  const { username, logout } = useAuth();
  const { isConnected, send, addListener, removeListener } = useWebSocket();

  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [contacts, setContacts] = useState<Contact[]>([]);

  // Handle incoming WS messages via listener
  useEffect(() => {
    const handleMessage = (msg: any) => {
      if (msg.type === 'chat_message' && msg.from) {
        const senderId = msg.from;
        const newMsg: Message = {
          id: Date.now().toString(),
          senderId,
          text: msg.text ?? '',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages(prev => ({
          ...prev,
          [senderId]: [...(prev[senderId] ?? []), newMsg],
        }));
      }
    };

    addListener(handleMessage);
    return () => removeListener(handleMessage);
  }, [addListener, removeListener]);

  // Fetch real contacts on load
  useEffect(() => {
    console.log(`[Discovery] Fetching contacts for ${username}...`);
    api.getDiscoveryContacts().then(allUsers => {
      console.log(`[Discovery] Found ${allUsers.length} total users:`, allUsers);
      const filtered = allUsers.filter(u => u.name !== username);
      console.log(`[Discovery] Setting contacts (filtered self):`, filtered);
      setContacts(filtered);
    }).catch(err => {
      console.error('[Discovery] Failed to fetch contacts:', err);
    });
  }, [username]);
  const handleSendMessage = (text: string) => {
    if (!activeContactId) return;

    const newMsg: Message = {
      id: Date.now().toString(),
      senderId: 'me',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => ({
      ...prev,
      [activeContactId]: [...(prev[activeContactId] ?? []), newMsg],
    }));

    // Send over WebSocket if connected
    send({ type: 'chat_message', to: activeContactId, text });
  };

  const activeContact = contacts.find(c => c.id === activeContactId) ?? null;
  const activeMessages = activeContactId ? (messages[activeContactId] ?? []) : [];

  return (
    <div className="layout-container">
      {/* Connection status badge */}
      <div className={`ws-status ${isConnected ? 'connected' : 'disconnected'}`}>
        {isConnected ? '● Connected' : '○ Offline'}
      </div>

      <Sidebar
        contacts={contacts}
        activeContactId={activeContactId}
        onSelectContact={setActiveContactId}
        currentUser={username ?? 'You'}
        onLogout={logout}
      />
      <ChatArea
        contact={activeContact}
        messages={activeMessages}
        onSendMessage={handleSendMessage}
      />
    </div>
  );
}

function App() {
  const { token } = useAuth();
  return token ? <ChatApp /> : <AuthPage />;
}

export default App;
