import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, MoreVertical, Shield } from 'lucide-react';
import type { Contact, Message } from '../App';

interface ChatAreaProps {
  contact: Contact | null;
  messages: Message[];
  onSendMessage: (text: string) => void;
}

const ChatArea = ({ contact, messages, onSendMessage }: ChatAreaProps) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText);
      setInputText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  if (!contact) {
    return (
      <div className="empty-state">
        <Shield className="empty-state-icon" />
        <h3>End-to-End Encrypted LAN Chat</h3>
        <p>Select a peer from the sidebar to start secure messaging and lightning-fast file transfers.</p>
      </div>
    );
  }

  return (
    <div className="chat-area">
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="avatar">
            {contact.name.charAt(0).toUpperCase()}
            {contact.status === 'online' && <div className="status-indicator"></div>}
          </div>
          <div className="chat-header-text">
            <h2>{contact.name}</h2>
            <p>{contact.status === 'online' ? 'Online on LAN' : 'Offline'}</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-btn" title="Send File"><Paperclip size={20} /></button>
          <button className="icon-btn" title="More Options"><MoreVertical size={20} /></button>
        </div>
      </div>

      <div className="messages-container">
        {messages.map((msg) => {
          const isMe = msg.senderId === 'me';
          return (
            <div key={msg.id} className={`message-wrapper ${isMe ? 'sent' : 'received'}`}>
              <div>
                <div className="message-bubble">
                  {msg.text}
                </div>
                <span className="message-time">{msg.timestamp}</span>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        <button className="icon-btn" style={{ padding: '12px' }} title="Attach File">
          <Paperclip size={24} />
        </button>
        
        <form className="input-wrapper" onSubmit={handleSend} style={{ flex: 1, margin: 0, padding: 0, background: 'transparent', border: 'none', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div className="input-wrapper" style={{ flex: 1 }}>
            <textarea 
              className="chat-input" 
              placeholder="Type a secure message..." 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
          </div>
          <button type="submit" className="send-btn" disabled={!inputText.trim()}>
            <Send size={20} style={{ marginLeft: '4px' }} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatArea;
