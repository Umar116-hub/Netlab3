// Generates a stable device ID from browser fingerprint, persisted in localStorage

// Generates a stable UUID v4 with a fallback for insecure contexts (LAN testing)
export function uuidv4(): string {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  
  // High-quality fallback for environments where crypto.randomUUID is missing
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Generates a stable device ID from browser fingerprint, persisted in localStorage
export function getOrCreateDeviceId(): string {
  const stored = localStorage.getItem('nls_device_id');
  if (stored) return stored;

  const id = uuidv4();
  localStorage.setItem('nls_device_id', id);
  return id;
}

// Generates a mock identity key pair for initial registration
export async function generateIdentityKey(): Promise<{ publicKey: string; fingerprint: string }> {
  // If subtle is missing (insecure context), use a simple mock
  if (!crypto.subtle) {
    console.warn('[Crypto] subtle is missing in this context. Generating mock keys for LAN testing.');
    const mockKey = Array.from({length: 32}, () => Math.floor(Math.random() * 256));
    const publicKeyB64 = btoa(String.fromCharCode(...new Uint8Array(mockKey)));
    const fingerprint = mockKey.map(b => b.toString(16).padStart(2, '0')).join(':').substring(0, 47);
    return { publicKey: publicKeyB64, fingerprint };
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );

  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicKeyB64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyRaw)));

  // SHA-256 fingerprint
  const hashBuf = await crypto.subtle.digest('SHA-256', publicKeyRaw);
  const fingerprint = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(':')
    .substring(0, 47);

  return { publicKey: publicKeyB64, fingerprint };
}
