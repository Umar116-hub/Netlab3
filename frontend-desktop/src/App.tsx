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
  const { myName, contacts, clearUnread } = useDesktopNet();
  const [activeContactId, setActiveContactId] = useState<string | null>(null);

  const handleSelectContact = (id: string | null) => {
    setActiveContactId(id);
    if (id) {
      clearUnread(id);
    }
  };


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
