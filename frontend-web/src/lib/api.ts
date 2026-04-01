// Central API client for communicating with the backend

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3003';
export const WS_BASE = API_BASE.replace(/^http/, 'ws');

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
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('nls_token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
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
    request<{ message: string; accountId: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: LoginPayload) =>
    request<LoginResult>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  ping: () => request<{ status: string; time: string }>('/ping'),
  getDiscoveryContacts: () => request<any[]>('/api/contacts/discovery'),
};
