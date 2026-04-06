import { useState } from 'react';
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
  const { myName, contacts, messages, sendMessage, clearUnread } = useDesktopNet();
  const [activeContactId, setActiveContactId] = useState<string | null>(null);

  const handleSelectContact = (id: string | null) => {
    setActiveContactId(id);
    if (id) {
      clearUnread(id);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!activeContactId) return;
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
        onSelectContact={handleSelectContact}
        currentUser={myName}
        onLogout={() => {}}
      />
      <ChatArea contactId={activeContactId} />
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
