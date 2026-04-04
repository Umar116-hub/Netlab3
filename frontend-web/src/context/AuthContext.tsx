import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import React from 'react';
import { api, WS_BASE } from '../lib/api';
import { getOrCreateDeviceId, generateIdentityKey } from '../lib/crypto';

interface AuthState {
  token: string | null;
  accountId: string | null;
  username: string | null;
  isAdmin: boolean;
}

interface AuthContextValue extends AuthState {
  register: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: localStorage.getItem('nls_token'),
    accountId: localStorage.getItem('nls_account_id'),
    username: localStorage.getItem('nls_username'),
    isAdmin: localStorage.getItem('nls_is_admin') === 'true',
  });

  const register = useCallback(async (username: string, password: string) => {
    const deviceId = getOrCreateDeviceId();
    const { publicKey, fingerprint } = await generateIdentityKey();

    await api.register({
      username,
      password,
      device_id: deviceId,
      identity_key_public: publicKey,
      identity_key_fingerprint: fingerprint,
    });

    // Immediately log in after registration
    const result = await api.login({ username, password, device_id: deviceId });

    localStorage.setItem('nls_token', result.token);
    localStorage.setItem('nls_account_id', result.account_id);
    localStorage.setItem('nls_username', username);
    localStorage.setItem('nls_is_admin', result.is_admin ? 'true' : 'false');

    setState({ token: result.token, accountId: result.account_id, username, isAdmin: result.is_admin === true });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const deviceId = getOrCreateDeviceId();
    const result = await api.login({ username, password, device_id: deviceId });

    localStorage.setItem('nls_token', result.token);
    localStorage.setItem('nls_account_id', result.account_id);
    localStorage.setItem('nls_username', username);
    localStorage.setItem('nls_is_admin', result.is_admin ? 'true' : 'false');

    setState({ token: result.token, accountId: result.account_id, username, isAdmin: result.is_admin === true });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('nls_token');
    localStorage.removeItem('nls_account_id');
    localStorage.removeItem('nls_username');
    localStorage.removeItem('nls_is_admin');
    localStorage.removeItem('nls_device_id');
    setState({ token: null, accountId: null, username: null, isAdmin: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

interface WebSocketContextValue {
  socket: WebSocket | null;
  isConnected: boolean;
  onlineUserIds: Set<string>;
  setOnlineUserIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  send: (payload: object) => void;
  addListener: (callback: (msg: any) => void) => void;
  removeListener: (callback: (msg: any) => void) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const socketRef = useRef<WebSocket | null>(null);
  const listeners = useRef<Set<(msg: any) => void>>(new Set());
  const reconnectTimeoutRef = useRef<any>(null);
  const signalQueue = useRef<object[]>([]);

  const addListener = useCallback((cb: (msg: any) => void) => {
    listeners.current.add(cb);
  }, []);

  const removeListener = useCallback((cb: (msg: any) => void) => {
    listeners.current.delete(cb);
  }, []);

  const flushQueue = useCallback(() => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && signalQueue.current.length > 0) {
      console.log(`[WS] Flushing ${signalQueue.current.length} queued messages`);
      while (signalQueue.current.length > 0) {
        const msg = signalQueue.current.shift();
        if (msg) ws.send(JSON.stringify(msg));
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (!token) {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      setIsConnected(false);
      return;
    }

    // If already connecting or open, don't start another one
    if (socketRef.current && (socketRef.current.readyState === WebSocket.CONNECTING || socketRef.current.readyState === WebSocket.OPEN)) {
      return;
    }

    // Clear any pending reconnects
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    console.log('[WS] Connecting to LAN server...');
    const ws = new WebSocket(`${WS_BASE}/ws?token=${token}`);
    socketRef.current = ws;

    ws.onopen = () => {
      if (socketRef.current !== ws) {
        ws.close();
        return;
      }
      console.log('[WS] Socket Connected');
      setIsConnected(true);
      flushQueue();
      
      // Fetch initial online users
      api.getOnlineUsers().then(users => {
        setOnlineUserIds(new Set(users.map((u: any) => u.id)));
      }).catch(err => console.error('[WS] Failed to fetch initial online users:', err));
    };

    ws.onmessage = (event) => {
      if (socketRef.current !== ws) return;
      try {
        const msg = JSON.parse(event.data);
        console.log('[WS] Message received:', msg.type, msg);
        
        if (msg.type === 'authenticated') {
          console.log('%c[WS] MY PEER ID: ' + msg.accountId, 'background: #222; color: #bada55; font-size: 1.2em; font-weight: bold;');
        }
        
        if (msg.type === 'presence_update') {
          setOnlineUserIds(prev => {
            const next = new Set(prev);
            if (msg.status === 'online') {
              next.add(msg.accountId);
            } else {
              next.delete(msg.accountId);
            }
            return next;
          });
        }
        
        listeners.current.forEach((cb: (msg: any) => void) => cb(msg));
      } catch {
        console.warn('[WS] Non-JSON message:', event.data);
      }
    };

    ws.onclose = (e) => {
      console.log(`[WS] Socket Disconnected (Code: ${e.code}, Reason: ${e.reason})`);
      
      if (socketRef.current === ws) {
        socketRef.current = null;
        setIsConnected(false);
        setOnlineUserIds(new Set());
        
        if (token && !reconnectTimeoutRef.current) {
          console.log('[WS] Reconnecting in 3s...');
          reconnectTimeoutRef.current = setTimeout(connect, 3000);
        }
      }
    };

    ws.onerror = (err) => {
      if (socketRef.current === ws) {
        console.error('[WS] Socket Error:', err);
      }
    };
  }, [token, flushQueue]);

  useEffect(() => {
    connect();
    return () => {
      if (socketRef.current) {
        const ws = socketRef.current;
        socketRef.current = null; // Important: Clear ref before closing to prevent onclose trigger
        ws.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  const send = useCallback((payload: object) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      console.log(`[WS] Socket not ready (${ws?.readyState}). Queueing ${(payload as any).type}`);
      signalQueue.current.push(payload);
    }
  }, []);

  return (
    <WebSocketContext.Provider value={{ socket: socketRef.current, isConnected, onlineUserIds, setOnlineUserIds, send, addListener, removeListener }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocket must be used inside <WebSocketProvider>');
  return ctx;
}
