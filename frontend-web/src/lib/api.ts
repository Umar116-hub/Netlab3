// Central API client for communicating with the backend

const DEFAULT_HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
export const API_BASE = import.meta.env.VITE_API_URL ?? `http://${DEFAULT_HOST}:3004`;
export const WS_BASE = API_BASE.replace(/^https/, 'wss').replace(/^http/, 'ws');

export interface RegisterPayload {
  username: string;
  password: string;
  device_id: string;
  identity_key_public: string;
  identity_key_fingerprint: string;
}

export interface LoginPayload {
  username: string;
  password: string;
  device_id: string;
}

export interface LoginResult {
  token: string;
  account_id: string;
  is_admin: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('nls_token');
  const headers: HeadersInit = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers ?? {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Request failed');
  }
  return res.json() as Promise<T>;
}

export const api = {
  register: (payload: RegisterPayload) =>
    request<{ message: string; accountId: string; is_admin: boolean }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: LoginPayload) =>
    request<LoginResult>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteAccount: (accountId: string) => 
    request<{ message: string }>(`/api/auth/account/${accountId}`, {
      method: 'DELETE'
    }),

  ping: () => request<{ status: string; time: string }>('/ping'),
  getDiscoveryContacts: () => request<any[]>('/api/contacts/discovery'),
  getMessages: (conversationId: string) => request<{ messages: any[] }>(`/api/messages/${conversationId}`),
  getOnlineUsers: () => request<any[]>('/api/debug/clients'),

  saveFileOffer: (to: string, file_info: object) =>
    request<{ message_id: string; conversation_id: string }>('/api/messages/file-offer', {
      method: 'POST',
      body: JSON.stringify({ to, file_info }),
    }),

  updateFileStatus: (transfer_id: string, status: string, to: string) =>
    request<{ ok: boolean }>('/api/messages/update-file-status', {
      method: 'POST',
      body: JSON.stringify({ transfer_id, status, to }),
    }),
};
