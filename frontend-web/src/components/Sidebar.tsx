import { useState } from 'react';
import { Search, Edit, LogOut } from 'lucide-react';
import type { Contact } from '../App';

interface SidebarProps {
  contacts: Contact[];
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
          <h1>NetLab Chat</h1>
          {currentUser && <span className="sidebar-username">{currentUser}</span>}
        </div>
        <div className="sidebar-header-actions">
          <button className="icon-btn" title="New Chat">
            <Edit size={20} />
          </button>
          {onLogout && (
            <button className="icon-btn" title="Sign out" onClick={onLogout}>
              <LogOut size={18} />
            </button>
          )}
        </div>
      </div>
      
      <div className="search-container">
        <Search className="search-icon" size={18} />
        <input 
          type="text" 
          className="search-input" 
          placeholder="Search LAN peers..." 
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
              <div className="contact-name">{contact.name}</div>
              {contact.lastMessage && (
                <div className="contact-preview">{contact.lastMessage}</div>
              )}
            </div>
          </div>
        ))}
        {filteredContacts.length === 0 && (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No peers found.
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
