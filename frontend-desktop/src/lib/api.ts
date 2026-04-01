// API client for the desktop Electron frontend
// In Electron, nodeIntegration=true so we could also use node:http,
// but fetch is available in Electron's renderer (Chromium), so we use it for consistency.

export const API_BASE = (window as any).__NLS_API_URL__ ?? 'http://localhost:3004';
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
};
