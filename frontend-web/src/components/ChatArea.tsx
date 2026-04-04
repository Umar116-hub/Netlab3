import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, MoreVertical, Shield, File as FileIcon } from 'lucide-react';
import type { Contact, Message } from '../App';
import { useTransfer } from '../context/TransferContext';
import { useWebSocket } from '../context/AuthContext';

interface ChatAreaProps {
  contact: Contact | null;
  messages: Message[];
  onSendMessage: (text: string) => void;
  onLocalFileSent?: (contactId: string, file_info: any) => void;
  onBack?: () => void;
}

const ChatArea = ({ contact, messages, onSendMessage, onLocalFileSent, onBack }: ChatAreaProps) => {
  const [inputText, setInputText] = useState('');
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { transfers, sendFile, acceptFile } = useTransfer();
  const { onlineUserIds } = useWebSocket();
  
  const isOnline = contact ? onlineUserIds.has(contact.id) : false;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stagedFile) {
      await handleStagedSend();
    }
    if (inputText.trim()) {
      onSendMessage(inputText);
      setInputText('');
    }
  };

  const handleStagedSend = async () => {
    if (stagedFile && contact) {
      try {
        const tid = await sendFile(contact.id, stagedFile);
        if (onLocalFileSent) {
          onLocalFileSent(contact.id, {
            transfer_id: tid,
            name: stagedFile.name,
            size: stagedFile.size,
            type: stagedFile.type
          });
        }
        setStagedFile(null);
      } catch (err) {
        console.error('Failed to send file:', err);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (stagedFile) {
        handleStagedSend();
      } else if (inputText.trim()) {
        handleSend(e);
      }
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setStagedFile(file);
      e.target.value = '';
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
      <input 
        type="file" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        onChange={handleFileChange} 
      />

      <div className="chat-header">
        <div className="chat-header-info">
          {onBack && (
            <button className="icon-btn mobile-back-btn" onClick={onBack} title="Back to Contacts">
              <MoreVertical size={24} />
            </button>
          )}
          <div className="avatar">
            {contact.name.charAt(0).toUpperCase()}
            {isOnline && <div className="status-indicator"></div>}
          </div>
          <div className="chat-header-text">
            <h2>{contact.name}</h2>
            <p>{isOnline ? 'Online' : 'Offline'}</p>
          </div>
        </div>
      </div>

      <div className="messages-container" ref={scrollRef}>
        {messages.map((msg) => {
          if (!msg.file_info && !msg.text?.trim()) return null;

          const isMe = msg.senderId === 'me';
          const transfer = msg.file_info ? transfers.find(t => t.id === msg.file_info?.transfer_id) : null;
          
          return (
            <div key={msg.id} className={`message-wrapper ${isMe ? 'sent' : 'received'}`}>
              <div style={{ maxWidth: '100%' }}>
                {msg.file_info ? (
                  /* File Message Bubble */
                  <div className="file-message-bubble">
                    <div className="file-message-header">
                      <div className="file-icon-wrapper">
                        <FileIcon size={20} />
                      </div>
                      <div className="file-message-info">
                        <span className="file-message-name">{msg.file_info.name}</span>
                        <span className="file-message-size">{formatFileSize(msg.file_info.size)}</span>
                      </div>
                    </div>
                    
                    {transfer && transfer.status === 'active' && (
                      <div className="file-message-progress">
                        <div 
                          className="file-message-progress-fill" 
                          style={{ width: `${transfer.progress}%` }}
                        ></div>
                        <div className="file-message-metrics">
                           {transfer.speed && (
                             <span>{(transfer.speed / (1024 * 1024)).toFixed(1)} MB/s</span>
                           )}
                           {transfer.timeRemaining !== undefined && transfer.timeRemaining > 0 && (
                             <span>Remains: {Math.ceil(transfer.timeRemaining)}s</span>
                           )}
                        </div>
                      </div>
                    )}

                    <div className="file-message-actions">
                      {!isMe && (!transfer?.status && !msg.file_info?.status || transfer?.status === 'pending') ? (
                        <button 
                          className="file-message-btn accept"
                          onClick={() => acceptFile(msg.senderId, msg.file_info?.transfer_id)}
                        >
                          Accept & Download
                        </button>
                      ) : (
                        <span className="file-message-status">
                          {(transfer?.status || msg.file_info?.status) === 'error' ? '✕ Unreceived' :
                           (transfer?.status || msg.file_info?.status) === 'completed' ? '✓ Received' : 
                           (transfer?.status === 'active' || transfer?.status === 'connecting') ? `Transferring... ${Math.round(transfer.progress)}%` : 
                           'Sent Offer'}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Standard Text Message Bubble */
                  <div className="message-bubble">
                    {msg.text}
                  </div>
                )}
                <span className="message-time">{msg.timestamp}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="chat-input-container">
        {stagedFile && (
          <div className="staged-file-bar">
            <div className="staged-file-info">
              <FileIcon size={16} />
              <span className="staged-file-name">{stagedFile.name}</span>
              <span className="staged-file-size">({formatFileSize(stagedFile.size)})</span>
            </div>
            <div className="staged-file-actions">
               <button type="button" className="staged-cancel" onClick={() => setStagedFile(null)}>Cancel</button>
               <button type="button" className="staged-send desktop-only" onClick={handleStagedSend}>Send File</button>
            </div>
          </div>
        )}
        
        <form className="input-wrapper" onSubmit={handleSend} style={{ flex: 1, margin: 0, padding: 0, background: 'transparent', border: 'none', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div className="input-wrapper" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button 
              type="button"
              className="icon-btn attach-btn" 
              title="Attach File"
              onClick={() => fileInputRef.current?.click()}
              style={{ color: 'var(--text-secondary)', padding: '4px' }}
            >
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
          </div>
          <button 
            type="submit" 
            className="send-btn" 
            disabled={!inputText.trim() && !stagedFile}
            onMouseDown={(e) => e.preventDefault()}
          >
            <Send size={20} style={{ transform: 'translate(-1px, 1px)' }} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatArea;
