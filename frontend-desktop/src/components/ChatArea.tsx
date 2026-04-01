import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, MoreVertical, Shield } from 'lucide-react';
import { useDesktopNet } from '../context/DesktopNetProvider';
import type { DesktopContact } from '../context/DesktopNetProvider';
import type { Message } from '../App';

interface ChatAreaProps {
  contact: DesktopContact | null;
  messages: Message[];
  onSendMessage: (text: string) => void;
}

const ChatArea = ({ contact, messages, onSendMessage }: ChatAreaProps) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { transfers, sendFile, acceptFile } = useDesktopNet();

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

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleFileClick = () => {
    if (contact) {
      sendFile(contact.id);
    }
  };

  if (!contact) {
    return (
      <div className="empty-state">
        <Shield className="empty-state-icon" />
        <h3>Native LAN Mode</h3>
        <p>You are disconnected from the server. P2P discovery is active. Select a peer to transfer files at raw socket speeds.</p>
      </div>
    );
  }

  return (
    <div className="chat-area">
      {/* Transfer Overlay */}
      <div className="transfer-overlay">
        {transfers.filter(t => t.status !== 'completed' || t.progress < 100).map(transfer => (
          <div key={transfer.id} className="transfer-item">
            <div className="transfer-info">
              <span className="transfer-name">{transfer.name}</span>
              <span className="transfer-size">{formatFileSize(transfer.size)}</span>
            </div>
            
            <div className="progress-container">
              <div 
                className="progress-bar" 
                style={{ width: `${transfer.progress}%` }}
              ></div>
            </div>

            <div className="transfer-actions">
              {transfer.status === 'pending' && transfer.direction === 'receiving' ? (
                <>
                  <button className="transfer-btn reject">Reject</button>
                  <button 
                    className="transfer-btn accept"
                    onClick={() => acceptFile(transfer.id)}
                  >
                    Accept
                  </button>
                </>
              ) : (
                <span className={`transfer-status status-${transfer.status}`}>
                  {transfer.status === 'active' ? `${Math.round(transfer.progress)}%` : transfer.status}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="chat-header">
        <div className="chat-header-info">
          <div className="avatar">
            {contact.name.charAt(0).toUpperCase()}
            {contact.status === 'online' && <div className="status-indicator"></div>}
          </div>
          <div className="chat-header-text">
            <h2>{contact.name}</h2>
            <p>{contact.status === 'online' ? 'Online' : 'Offline'} ({contact.ip})</p>
          </div>
        </div>
        <div className="header-actions">
          <button 
            className="icon-btn" 
            title="Send File Native TCP"
            onClick={handleFileClick}
          >
            <Paperclip size={20} />
          </button>
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
        <button 
          className="icon-btn" 
          style={{ padding: '12px' }} 
          title="Attach File Native TCP"
          onClick={handleFileClick}
        >
          <Paperclip size={24} />
        </button>
        
        <form className="input-wrapper" onSubmit={handleSend} style={{ flex: 1, margin: 0, padding: 0, background: 'transparent', border: 'none', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div className="input-wrapper" style={{ flex: 1 }}>
            <textarea 
              className="chat-input" 
              placeholder="Type a secure message over TCP..." 
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
