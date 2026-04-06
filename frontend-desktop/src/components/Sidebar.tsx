import { useState } from 'react';
import { Search, MoreVertical, LogOut, MessageSquare } from 'lucide-react';
import type { DesktopContact } from '../context/DesktopNetProvider';

interface SidebarProps {
  contacts: DesktopContact[];
  activeContactId: string | null;
  onSelectContact: (id: string) => void;
  currentUser?: string;
  onLogout?: () => void;
}

const Sidebar = ({ contacts, activeContactId, onSelectContact, currentUser, onLogout }: SidebarProps) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredContacts = contacts.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-left">
          <h1>NetLab LAN</h1>
          {currentUser && <span className="sidebar-username">{currentUser}</span>}
        </div>
        <div className="sidebar-header-actions">
          {onLogout && (
            <button className="icon-btn" title="Sign out" onClick={onLogout}>
              <LogOut size={18} />
            </button>
          )}
        </div>
      </div>
      
      <div className="search-container">
        <Search className="search-icon" size={16} />
        <input 
          type="text" 
          className="search-input" 
          placeholder="Search peers..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="contact-list">
        {filteredContacts.map(contact => (
          <div 
            key={contact.id} 
            className={`contact-item ${activeContactId === contact.id ? 'active' : ''}`}
            onClick={() => onSelectContact(contact.id)}
          >
            <div className="avatar">
              {contact.name.charAt(0).toUpperCase()}
              {contact.status === 'online' && <div className="status-indicator"></div>}
            </div>
            <div className="contact-info">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                <span className="contact-name">{contact.name}</span>
                {contact.unreadCount !== undefined && contact.unreadCount > 0 && (
                  <span className="unread-badge">{contact.unreadCount}</span>
                )}
              </div>
              <div className="contact-preview">
                {contact.lastMessage || (contact.status === 'online' ? 'Online' : 'Offline')}
              </div>
            </div>
          </div>
        ))}
        
        {filteredContacts.length === 0 && (
          <div className="empty-state" style={{ padding: '40px 20px' }}>
            <MessageSquare size={32} style={{ opacity: 0.2, marginBottom: '12px' }} />
            <p style={{ fontSize: '0.8rem', opacity: 0.5 }}>No peers discovered yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
