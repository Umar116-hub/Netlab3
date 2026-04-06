import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, MoreVertical, Shield, File as FileIcon } from 'lucide-react';
import { useDesktopNet } from '../context/DesktopNetProvider';
import type { DesktopContact, DesktopMessage } from '../context/DesktopNetProvider';

interface ChatAreaProps {
  contact: DesktopContact | null;
  messages: DesktopMessage[];
  onSendMessage: (text: string) => void;
  onBack?: () => void;
}

const ChatArea = ({ contact, messages, onSendMessage, onBack }: ChatAreaProps) => {
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { transfers, sendFile, acceptFile, rejectFile } = useDesktopNet();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
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
        <p>Select a peer to start transferring files and messages at raw socket speeds.</p>
      </div>
    );
  }

  return (
    <div className="chat-area">
      <div className="chat-header">
        <div className="chat-header-info">
          {onBack && (
            <button className="icon-btn mobile-back-btn" onClick={onBack}>
              <MoreVertical size={24} />
            </button>
          )}
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
           <button className="icon-btn" onClick={handleFileClick} title="Send File"><Paperclip size={20} /></button>
           <button className="icon-btn"><MoreVertical size={20} /></button>
        </div>
      </div>

      <div className="messages-container" ref={scrollRef}>
        {messages.map((msg) => {
          const isMe = msg.senderId === 'me';
          return (
            <div key={msg.id} className={`message-wrapper ${isMe ? 'sent' : 'received'}`}>
              <div style={{ maxWidth: '100%' }}>
                <div className="message-bubble">
                  {msg.text}
                </div>
                <span className="message-time">{msg.timestamp}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Transfer Overlay (Modern Style) */}
      {transfers.length > 0 && (
        <div className="transfer-overlay">
          {transfers.filter(t => t.status !== 'completed' && t.status !== 'error').map(t => (
            <div key={t.id} className="transfer-card">
              <div className="transfer-card-header">
                <FileIcon size={16} />
                <span className="transfer-card-name">{t.name}</span>
                <span className="transfer-card-size">{formatFileSize(t.size)}</span>
              </div>
              <div className="transfer-card-progress">
                <div className="progress-bar" style={{ width: `${t.progress}%` }}></div>
              </div>
              <div className="transfer-card-footer">
                {t.status === 'pending' && t.direction === 'receiving' ? (
                  <div className="transfer-actions">
                    <button onClick={() => rejectFile(t.id)} className="transfer-btn reject">Reject</button>
                    <button onClick={() => acceptFile(t.id)} className="transfer-btn accept">Accept</button>
                  </div>
                ) : (
                  <div className="transfer-status-row">
                    <span>{t.direction === 'sending' ? 'Sending...' : 'Receiving...'}</span>
                    <span>{Math.round(t.progress)}%</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="chat-input-container">
        <button 
          className="icon-btn" 
          onClick={handleFileClick}
          title="Attach File"
          style={{ padding: '12px' }}
        >
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
            <Send size={20} style={{ transform: 'translate(-1px, 1px)' }} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatArea;
