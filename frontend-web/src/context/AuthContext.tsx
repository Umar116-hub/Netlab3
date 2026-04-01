import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { api, WS_BASE } from '../lib/api';
import { getOrCreateDeviceId, generateIdentityKey } from '../lib/crypto';

interface AuthState {
  token: string | null;
  accountId: string | null;
  username: string | null;
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

    setState({ token: result.token, accountId: result.account_id, username });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const deviceId = getOrCreateDeviceId();
    const result = await api.login({ username, password, device_id: deviceId });

    localStorage.setItem('nls_token', result.token);
    localStorage.setItem('nls_account_id', result.account_id);
    localStorage.setItem('nls_username', username);

    setState({ token: result.token, accountId: result.account_id, username });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('nls_token');
    localStorage.removeItem('nls_account_id');
    localStorage.removeItem('nls_username');
    setState({ token: null, accountId: null, username: null });
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
  send: (payload: object) => void;
  addListener: (callback: (msg: any) => void) => void;
  removeListener: (callback: (msg: any) => void) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
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
    if (!token) return;

    if (socketRef.current) {
      socketRef.current.close();
    }

    console.log('[WS] Connecting to LAN server...');
    const ws = new WebSocket(`${WS_BASE}/ws?token=${token}`);
    socketRef.current = ws;

    ws.onopen = () => {
      if (socketRef.current !== ws) return;
      console.log('[WS] Socket Connected');
      setIsConnected(true);
      flushQueue();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      if (socketRef.current !== ws) return;
      try {
        const msg = JSON.parse(event.data);
        console.log('[WS] Message received:', msg.type, msg);
        
        if (msg.type === 'authenticated') {
          console.log('%c[WS] MY PEER ID: ' + msg.accountId, 'background: #222; color: #bada55; font-size: 1.2em; font-weight: bold;');
        }
        
        listeners.current.forEach((cb: (msg: any) => void) => cb(msg));
      } catch {
        console.warn('[WS] Non-JSON message:', event.data);
      }
    };

    ws.onclose = () => {
      console.log('[WS] Socket Disconnected');
      
      // Only null out and trigger reconnect if this is STILL the current socket
      if (socketRef.current === ws) {
        socketRef.current = null;
        setIsConnected(false);
        
        if (token && !reconnectTimeoutRef.current) {
          console.log('[WS] Reconnecting in 2s...');
          reconnectTimeoutRef.current = setTimeout(connect, 2000);
        }
      }
    };

    ws.onerror = (err) => {
      if (socketRef.current === ws) {
        console.error('[WS] Socket Error:', err);
      }
    };
  }, [token]);

  useEffect(() => {
    connect();
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
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
    <WebSocketContext.Provider value={{ socket: socketRef.current, isConnected, send, addListener, removeListener }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocket must be used inside <WebSocketProvider>');
  return ctx;
}
