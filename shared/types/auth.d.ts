export interface Account {
    id: string;
    username: string;
    password_hash: string;
    created_at: string;
    disabled_at?: string | null;
    deleted_at?: string | null;
}
export interface Device {
    id: string;
    account_id: string;
    device_id: string;
    identity_key_public: Buffer;
    identity_key_fingerprint: string;
    created_at: string;
    last_seen_at?: string | null;
    deleted_at?: string | null;
}
export interface Session {
    id: string;
    account_id: string;
    device_id?: string | null;
    token_hash: string;
    expires_at: string;
    revoked_at?: string | null;
    created_at: string;
    last_seen_at?: string | null;
}
export interface Prekey {
    id: string;
    device_id: string;
    type: 'SPK' | 'OPK';
    public_key: Buffer;
    signature?: Buffer | null;
    consumed_at?: string | null;
    created_at: string;
    deleted_at?: string | null;
}
//# sourceMappingURL=auth.d.ts.map