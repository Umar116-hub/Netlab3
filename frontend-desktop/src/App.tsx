import { useState, useEffect } from 'react';
import { DesktopNetProvider, useDesktopNet } from './context/DesktopNetProvider';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';

export interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
}

function P2PApp() {
  const { myName, contacts, sendMessage } = useDesktopNet();
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});

  // When IPC direct-signaling comes in, we should really listen inside Provider and export it,
  // but for hackability let's listen to IPC direct here for text chat.
  // Actually, we should just read from Provider. 
  useEffect(() => {
     const ipcR = (window as any).require ? (window as any).require('electron').ipcRenderer : null;
     if (!ipcR) return;

     const textHandler = (_e: any, { payload }: any) => {
         if (payload.type === 'chat') {
            const senderId = payload.from;
            const newMsg: Message = {
                id: Date.now().toString(),
                senderId,
                text: payload.text,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            };
            setMessages(prev => ({
                ...prev,
                [senderId]: [...(prev[senderId] ?? []), newMsg],
            }));
         }
     };

     ipcR.on('p2p:receive-direct-signaling', textHandler);
     return () => ipcR.removeListener('p2p:receive-direct-signaling', textHandler);
  }, []);

  const handleSendMessage = async (text: string) => {
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

    await sendMessage(activeContactId, text);
  };

  const activeContact = contacts.find(c => c.id === activeContactId) ?? null;
  const activeMessages = activeContactId ? (messages[activeContactId] ?? []) : [];

  return (
    <div className="layout-container">
      <div className="ws-status disconnected">
         ○ Serverless Mode (LAN Only)
      </div>

      <Sidebar
        contacts={contacts}
        activeContactId={activeContactId}
        onSelectContact={setActiveContactId}
        currentUser={myName}
        onLogout={() => {}}
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
  return (
    <DesktopNetProvider>
      <P2PApp />
    </DesktopNetProvider>
  );
}

export default App;
