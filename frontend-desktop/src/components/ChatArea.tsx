import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, MoreVertical, Shield, File as FileIcon, Pause, Play, X, Download } from 'lucide-react';
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
  const { transfers, sendFile, acceptFile, rejectFile, pauseTransfer, resumeTransfer, cancelTransfer } = useDesktopNet();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, transfers]);

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

  const formatDateDivider = (id: string): string => {
    try {
      const timestamp = id.includes('-') ? Date.now() : parseInt(id);
      const msgDate = new Date(timestamp);
      const today = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      
      if (msgDate.toDateString() === today) return 'Today';
      if (msgDate.toDateString() === yesterday) return 'Yesterday';
      return msgDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return ''; }
  };

  if (!contact) {
    return (
      <div className="empty-state">
        <Shield size={64} className="empty-state-icon" />
        <h3>Native LAN Mode</h3>
        <p>Your connection is secure and private. Messages and files go directly from this device to your peer.</p>
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
            <p>{contact.status === 'online' ? 'Online' : 'Offline'} • {contact.ip}</p>
          </div>
        </div>
        <div className="header-actions">
           <button className="icon-btn"><MoreVertical size={20} /></button>
        </div>
      </div>

      <div className="messages-container" ref={scrollRef}>
        {messages.reduce<React.ReactNode[]>((acc, msg, idx) => {
          const divider = formatDateDivider(msg.id);
          const prevDivider = idx > 0 ? formatDateDivider(messages[idx-1].id) : null;
          
          if (divider && divider !== prevDivider) {
            acc.push(<div key={`divider-${msg.id}`} className="date-divider"><span>{divider}</span></div>);
          }

          const isMe = msg.senderId === 'me';
          acc.push(
            <div key={msg.id} className={`message-wrapper ${isMe ? 'sent' : 'received'}`}>
              <div style={{ maxWidth: '100%' }}>
                <div className="message-bubble">{msg.text}</div>
                <span className="message-time">{msg.timestamp}</span>
              </div>
            </div>
          );
          return acc;
        }, [])}
      </div>

      {/* Transfer Panel - High Fidelity & Non-Overlapping */}
      {transfers.length > 0 && (
        <div className="transfer-panel">
          {transfers.filter(t => t.status !== 'cancelled').map(t => (
            <div key={t.id} className="transfer-card">
              <div className="transfer-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <FileIcon size={14} className="text-secondary" />
                  <span className="transfer-name">{t.name}</span>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {t.status === 'pending' && t.direction === 'receiving' && (
                    <button onClick={() => acceptFile(t.id)} className="transfer-btn accept">Accept</button>
                  )}
                  {t.status === 'active' && (
                    <button onClick={() => pauseTransfer(t.id)} className="icon-btn small"><Pause size={12} /></button>
                  )}
                  {t.status === 'paused' && (
                    <button onClick={() => resumeTransfer(t.id)} className="icon-btn small"><Play size={12} /></button>
                  )}
                  {t.status !== 'completed' && (
                    <button onClick={() => cancelTransfer(t.id)} className="icon-btn small"><X size={12} /></button>
                  )}
                </div>
              </div>
              
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${t.progress}%`, background: t.status === 'completed' ? 'var(--success)' : 'var(--accent-primary)' }}></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', opacity: 0.7 }}>
                <span>{t.status.toUpperCase()}</span>
                <span>{Math.round(t.progress)}%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="chat-input-container">
        <div className="input-wrapper">
          <button className="icon-btn" onClick={() => sendFile(contact.id)} title="Attach File">
            <Paperclip size={20} />
          </button>
          <textarea 
            className="chat-input" 
            placeholder="Type a secure message..." 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button className="send-btn" onClick={handleSend} disabled={!inputText.trim()}>
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatArea;
