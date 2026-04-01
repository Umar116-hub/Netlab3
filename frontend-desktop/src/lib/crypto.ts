// Generates a stable device ID persisted to localStorage

export function getOrCreateDeviceId(): string {
  const stored = localStorage.getItem('nls_device_id');
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem('nls_device_id', id);
  return id;
}

// Uses Web Crypto API (available in Electron renderer / Chromium)
export async function generateIdentityKey(): Promise<{ publicKey: string; fingerprint: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );

  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicKeyB64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyRaw)));

  const hashBuf = await crypto.subtle.digest('SHA-256', publicKeyRaw);
  const fingerprint = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(':')
    .substring(0, 47);

  return { publicKey: publicKeyB64, fingerprint };
}
