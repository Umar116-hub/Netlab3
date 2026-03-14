import { useState } from 'react';
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

const MOCK_CONTACTS: Contact[] = [
  { id: '1', name: 'Alice (Laptop)', status: 'online', lastMessage: 'Hey, did you get the file?' },
  { id: '2', name: 'Bob (Desktop)', status: 'offline', lastMessage: 'See you tomorrow.' },
  { id: '3', name: 'Charlie (Phone)', status: 'online', lastMessage: 'Sending the zip now...' },
];

const MOCK_MESSAGES: Record<string, Message[]> = {
  '1': [
    { id: 'm1', senderId: '1', text: 'Hey, did you get the file?', timestamp: '10:30 AM' },
    { id: 'm2', senderId: 'me', text: 'Yes! Downloading it now. Thanks!', timestamp: '10:31 AM' },
  ],
  '2': [
    { id: 'm3', senderId: 'me', text: 'Are we still on for the meeting?', timestamp: 'Yesterday' },
    { id: 'm4', senderId: '2', text: 'See you tomorrow.', timestamp: 'Yesterday' },
  ],
  '3': [
    { id: 'm5', senderId: '3', text: 'Sending the zip now...', timestamp: '11:45 AM' },
  ],
};

function App() {
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>(MOCK_MESSAGES);

  const activeContact = MOCK_CONTACTS.find(c => c.id === activeContactId) || null;
  const activeMessages = activeContactId ? (messages[activeContactId] || []) : [];

  const handleSendMessage = (text: string) => {
    if (!activeContactId) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      senderId: 'me',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => ({
      ...prev,
      [activeContactId]: [...(prev[activeContactId] || []), newMessage],
    }));
  };

  return (
    <div className="layout-container">
      <Sidebar 
        contacts={MOCK_CONTACTS} 
        activeContactId={activeContactId} 
        onSelectContact={setActiveContactId} 
      />
      <ChatArea 
        contact={activeContact} 
        messages={activeMessages} 
        onSendMessage={handleSendMessage} 
      />
    </div>
  );
}

export default App;
