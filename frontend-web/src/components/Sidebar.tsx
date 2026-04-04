import { useState } from 'react';
import { Search, RefreshCw, LogOut, Trash2 } from 'lucide-react';
import type { Contact } from '../App';
import { useWebSocket } from '../context/AuthContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

interface SidebarProps {
  contacts: Contact[];
  activeContactId: string | null;
  onSelectContact: (id: string | null) => void;
  currentUser?: string;
  unreadCounts?: Record<string, number>;
  onRefresh?: () => void;
  onLogout?: () => void;
}

const Sidebar = ({ contacts, activeContactId, onSelectContact, currentUser, unreadCounts = {}, onRefresh, onLogout }: SidebarProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'online' | 'all'>('online');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { onlineUserIds } = useWebSocket();
  const { isAdmin } = useAuth();
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const handleRefreshClick = () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    onRefresh?.();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleDeleteAccount = async (e: React.MouseEvent, accountId: string) => {
    e.stopPropagation();
    if (!isAdmin || isDeleting) return;
    if (!window.confirm('Are you sure you want to delete this test account?')) return;
    
    try {
      setIsDeleting(accountId);
      await api.deleteAccount(accountId);
      // Let the parent component refresh the contact list
      window.location.reload(); 
    } catch (err) {
      console.error('Failed to delete account', err);
      alert('Failed to delete account');
      setIsDeleting(null);
    }
  };

  // 1. Filter by search query
  let processedContacts = contacts.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 2. Filter by toggle mode
  if (filterMode === 'online') {
    processedContacts = processedContacts.filter(c => onlineUserIds.has(c.id));
  }

  // 3. Smart Sort: Online users first, then offline users, both alphabetically
  processedContacts.sort((a, b) => {
    const aOnline = onlineUserIds.has(a.id);
    const bOnline = onlineUserIds.has(b.id);
    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-left">
          <h1>NetLab {isAdmin && <span style={{fontSize:'0.6em', color:'#ff9800', background:'#ff980022', padding:'2px 6px', borderRadius:'10px', marginLeft:'5px'}}>ADMIN</span>}</h1>
          {currentUser && <span className="sidebar-username">{currentUser}</span>}
        </div>
        <div className="sidebar-header-actions">
          {onRefresh && (
            <button 
              className="icon-btn" 
              title="Refresh Peers" 
              onClick={handleRefreshClick}
              style={{ transition: 'transform 0.1s' }}
            >
              <RefreshCw 
                size={18} 
                style={{ 
                  transition: 'transform 0.8s ease', 
                  transform: isRefreshing ? 'rotate(360deg)' : 'rotate(0deg)' 
                }} 
              />
            </button>
          )}
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

      <div className="filter-toggle">
        <button 
           className={`toggle-btn ${filterMode === 'online' ? 'active' : ''}`}
           onClick={() => setFilterMode('online')}
        >
          Online
        </button>
        <button 
           className={`toggle-btn ${filterMode === 'all' ? 'active' : ''}`}
           onClick={() => setFilterMode('all')}
        >
          All Peers
        </button>
      </div>

      <div className={`contact-list ${isRefreshing ? 'refresh-blink' : ''}`}>
        {processedContacts.map(contact => {
          const isOnline = onlineUserIds.has(contact.id);
          return (
            <div 
              key={contact.id} 
              className={`contact-item ${activeContactId === contact.id ? 'active' : ''}`}
              onClick={() => onSelectContact(contact.id)}
            >
              <div className="avatar">
                {contact.name.charAt(0).toUpperCase()}
                {isOnline && <div className="status-indicator"></div>}
              </div>
              <div className="contact-info">
                <div className="contact-name">{contact.name}</div>
                <div className="contact-preview">
                  {isOnline ? 'Available' : 'Offline'}
                </div>
              </div>
              {unreadCounts[contact.id] > 0 && (
                <div className="unread-badge">
                  {unreadCounts[contact.id]}
                </div>
              )}
              {isAdmin && (
                <button 
                   className="icon-btn delete-btn" 
                   title="Delete test account"
                   disabled={isDeleting === contact.id}
                   onClick={(e) => handleDeleteAccount(e, contact.id)}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          );
        })}
        {processedContacts.length === 0 && (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No peers found.
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
