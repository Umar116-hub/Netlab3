import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, File as FileIcon, X, Pause, Play, Shield } from 'lucide-react';
import { useDesktopNet } from '../context/DesktopNetProvider';

interface ChatAreaProps {
  contactId: string | null;
}

const ChatArea = ({ contactId }: ChatAreaProps) => {
  const [inputText, setInputText] = useState('');
  const [stagedFile, setStagedFile] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const { 
    contacts, messages, transfers, 
    sendMessage, sendFileOffer, acceptFile, 
    pauseTransfer, resumeTransfer, cancelTransfer 
  } = useDesktopNet();

  const contact = contacts.find(c => c.id === contactId);
  const contactMessages = contactId ? (messages[contactId] || []) : [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [contactMessages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stagedFile && contactId) {
      await sendFileOffer(contactId, stagedFile);
      setStagedFile(null);
    }
    if (inputText.trim() && contactId) {
      await sendMessage(contactId, inputText);
      setInputText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const handleFileSelect = async () => {
    const ipcRenderer = (window as any).require('electron').ipcRenderer;
    const fileObj = await ipcRenderer.invoke('p2p:select-file');
    if (fileObj) {
      setStagedFile(fileObj);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSec?: number) => {
    if (!bytesPerSec) return '0 B/s';
    if (bytesPerSec > 1024 * 1024) return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
    return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  };

  const formatTime = (seconds?: number) => {
    if (seconds === undefined || seconds < 0) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (!contact) {
    return (
      <div className="empty-state">
        <Shield size={48} style={{ marginBottom: '20px', opacity: 0.5 }} />
        <h3>Select a contact to start chatting</h3>
        <p>Your messages and file transfers are direct and secure.</p>
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
            <p>{contact.status === 'online' ? 'Online' : 'Offline'}</p>
          </div>
        </div>
      </div>

      <div className="messages-container" ref={scrollRef}>
        {contactMessages.map((msg) => {
          const isMe = msg.senderId === 'me';
          const transfer = msg.file_info ? transfers.find(t => t.id === msg.file_info?.transfer_id) : null;
          const isPaused = transfer?.status === 'paused';
          const isActive = transfer?.status === 'active';

          return (
            <div key={msg.id} className={`message-wrapper ${isMe ? 'sent' : 'received'}`}>
              <div style={{ maxWidth: '100%' }}>
                {msg.file_info ? (
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

                    {transfer && (isActive || isPaused) && (
                      <>
                        <div className="file-message-progress">
                          <div 
                            className="file-message-progress-fill" 
                            style={{ width: `${transfer.progress}%`, opacity: isPaused ? 0.5 : 1 }}
                          ></div>
                        </div>
                        <div className="file-message-metrics">
                           <span>{formatSpeed(transfer.speed)}</span>
                           <span>Remains: {formatTime(transfer.timeRemaining)}</span>
                        </div>
                      </>
                    )}

                    <div className="file-message-actions">
                      {!isMe && (!transfer || transfer.status === 'pending') ? (
                        <button className="file-message-btn accept" onClick={() => acceptFile(msg.file_info!.transfer_id)}>
                          Accept & Download
                        </button>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                          <span className="file-message-status" style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                            {transfer?.status === 'completed' ? '✓ Received' : 
                             transfer?.status === 'error' ? '✕ Failed' :
                             isPaused ? '⏸ Paused' : 
                             isActive ? `Transferring... ${Math.round(transfer.progress)}%` : 'Sent Offer'}
                          </span>
                          
                          {transfer && (isActive || isPaused) && (
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button className="icon-btn small" onClick={() => isPaused ? resumeTransfer(transfer.id) : pauseTransfer(transfer.id)}>
                                {isPaused ? <Play size={14} /> : <Pause size={14} />}
                              </button>
                              <button className="icon-btn small" style={{ color: '#ef4444' }} onClick={() => cancelTransfer(transfer.id)}>
                                <X size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="message-bubble">{msg.text}</div>
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
              <span className="staged-send-label">Press Airplane to send</span>
              <button className="staged-cancel" onClick={() => setStagedFile(null)}>Cancel</button>
            </div>
          </div>
        )}

        <form className="input-wrapper" onSubmit={handleSend}>
          <button type="button" className="icon-btn" onClick={handleFileSelect}>
            <Paperclip size={20} />
          </button>
          <textarea 
            className="chat-input" 
            placeholder="Type a message..." 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button type="submit" className="send-btn" disabled={!inputText.trim() && !stagedFile}>
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatArea;
