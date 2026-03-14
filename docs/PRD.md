# LAN Chat + Fast File Share — PRD Working Notes

Working mode: you (client) describe goals; I (developer) challenge assumptions, identify constraints, and turn it into buildable requirements.

## 1) Decision Timeline (how we got here)
1) Started: “WhatsApp-like on LAN, extremely fast file sharing.”
2) Contradiction identified: web client requires server, but you want offline/serverless use.
3) Resolved: P2P fallback for 1:1 when server is off; server mode for richer features.
4) Groups: initially requested without server → deemed too complex → groups require server.
5) Routing: Hybrid (text via server, files direct P2P).
6) History: server stores encrypted history.
7) Privacy: E2EE required.
8) Tech stack chosen: Node/Electron.
9) Auth: server authenticates (LAN-local accounts).
10) Identity: client-generated.
11) Recovery: explicitly deferred.
12) Web file transfer: WebRTC with relay fallback.
13) Desktop file transfer: simplified to TCP in v1 (QUIC deferred).
14) Discovery: broadcast every 5s + manual fallback.
15) Messaging: no read receipts; delivered=decrypt+ACK; retry only when online; TTL=7 days.
16) Files: 2GB cap; resume supported; chunk=1MiB; SHA-256 hashes.

## 0) What you want (as stated)

### Core user experience
- WhatsApp-like features on a local LAN:
  - Text chat
  - Voice notes
  - Calls (voice, possibly video later)
  - File sharing
- Primary differentiator: file sharing should be LAN-fast (limited mainly by Wi‑Fi/Ethernet + router/switch throughput).

### “Server feature” + web access
- A server device can run on the LAN.
- If the server is running, you can open a browser, type the server’s IP, and a web page loads where you can:
  - See users
  - Chat with users
  - Ideally create groups
- The web page should work with no install (just paste IP and go).

### Availability questions you raised
- If the server is NOT running:
  - How do devices communicate?
  - How does peer-to-peer start?
- Group creation/management when:
  - Server is running
  - Server is NOT running
- Chat history storage:
  - Stored on both user devices?
  - Stored on server?
  - Concern: if stored on server, server can read everything.

## 1) Key decisions we must lock down
- **D1 — Operating modes**: 
  - Server OFF: direct P2P for 1:1 chat + fast file transfer.
  - Server ON: richer features + browser client.
- **D2 — Groups**: Groups require server (no groups when server is off).
- **D3 — Routing**: Hybrid routing when server is on:
  - Text: client → server → recipient(s)
  - Files: always direct P2P (server coordinates only)
- **D4 — History**: 
  - Server stores persistent history.
  - Clients store local copies too.
- **D5 — Privacy**: E2EE required: server stores only ciphertext; cannot read message contents.
- **D6 — Authentication**: Server authenticates users (account login).
- **D7 — Recovery**: Deferred / out of scope for now (explicit).
- **D7.5 — v1 Feature scope**: 
  - Decision: v1 = Text chat + File sharing only.
  - Voice notes and calls are deferred to later versions.
- **D8 — Tech stack**: Node.js stack (details below).

## 2) Reality checks / what’s “wrong” or ambiguous (developer feedback)

- **Speed expectations**: 
  - LAN file transfer can be very fast, but real speed depends on: Wi‑Fi standard, router/switch throughput, device disk speed, CPU if encryption/compression is used.
  - Also: if you route files through the server, you can bottleneck on the server. For max speed, the server should act as signaling/coordination, while file data flows direct device-to-device.
- **“No server running but both devices online”**: 
  - If the server is truly off and you still want chat: You need direct peer discovery (broadcast/multicast) and direct connections. Groups become tricky without a coordinator.
- **Web client without install**: 
  - Feasible if the server provides: HTTP(S) page + WebSocket for real-time chat, Authentication/session handling.
  - But: if the web client must work when the server is down, it can’t—because the browser needs some server endpoint.
- **History storage + server visibility**: 
  - If the server stores plaintext history, server admin can read it.
  - If you want server to host history without reading it, you need end-to-end encryption and the server stores only encrypted blobs. Then features like server-side search, moderation, etc. become limited.

## 3) Proposed system design (draft)

### Mode 1 — Server ON (best experience)
- Server provides: Account auth + sessions, Presence/directory, Group management, Text relay via WebSocket, Web client UI (HTTP + WebSocket), Encrypted history storage.
- Clients: Encrypt messages locally (E2EE) → send ciphertext, Decrypt locally for display, Keep local cache.
- File transfers: Server only coordinates (offers/accepts, NAT-less LAN details). Data flows device-to-device.

### Mode 2 — Server OFF (fallback)
- Only 1:1: Discovery + direct connection, E2EE still applies, No groups, no web client, no server history.

## 4) Key solution choices (developer proposes)

### 4.1 E2EE + server-auth + web client (solution)
Goal: server authenticates users, stores history, but cannot read content.
Approach (password-protected key bundle): 
- On first login, client generates: Identity key pair (IK), Signed prekey (SPK) + one-time prekeys (OPKs) for initiating chats.
- Client uploads public keys to server.
- Client encrypts its private keys into an “encrypted key bundle” using a key derived from the user’s password (Argon2id) and uploads that encrypted bundle to server.
- When user logs in on: Desktop app OR web browser
  - Server authenticates and returns the encrypted key bundle
  - The client (desktop/browser) decrypts locally using the password
  - Messages are stored on server as ciphertext + metadata.
Tradeoffs: 
- Pro: web client can access full history after login without QR-linking.
- Con: password compromise could expose keys/history; recovery is deferred; server still sees metadata.

## 5) Tech stack (chosen)

### 5.1 Desktop client
- Electron (UI)
- Node runtime with: WebSocket client for chat, QUIC/TCP for file transfer, Crypto libs

### 5.2 Server
- Node.js
- Web framework: Fastify (or Express)
- Real-time: WebSocket
- Database: PostgreSQL (messages, users, groups)
- Cache/queue (optional): Redis for presence + pub/sub

### 5.3 Web client
- Served by the server (static app)
- Real-time via WebSocket
- Decrypts locally in browser

### 5.4 LAN discovery (server-off 1:1)
- UDP broadcast + optional mDNS
- Manual IP fallback

### 5.5 File transfer transport
- Desktop-to-Desktop (v1): TCP-based direct P2P transfer
  - Transport abstraction layer required so QUIC can be introduced in future versions
  - Server coordinates but never proxies file bytes for desktop-to-desktop transfers

### 5.6 Web client file transfer
- WebRTC data channels for browser-based file transfer (P2P when possible)
  - Server provides signaling (offer/answer + ICE candidates)
  - Prefer LAN-direct connection
  - If P2P cannot be established: fallback to server relay (encrypted bytes only)
    - Sender uploads encrypted chunks to server
    - Receiver downloads encrypted chunks from server
    - Decryption happens client-side (browser)

### 5.7 WebRTC failure UX
- Decision: On failure, app must show a clear, actionable reason (phase-based diagnosis), e.g.: signaling not completed, no ICE candidates gathered, ICE negotiation timed out, UDP blocked / firewall restrictions, AP/client isolation, peer went offline during handshake.
- Provide an optional “Details” view for debugging (state transitions, timers, candidate counts).

## 6) What we’ve decided so far

### Operating Modes
- **Server OFF**: Direct P2P 1:1 text, Direct P2P file transfer, No groups, No web client.
- **Server ON**: LAN-local account authentication, Groups enabled, Web client available via browser, Text routed through server (ciphertext), Files always direct P2P, Server stores encrypted history.

### Discovery (Server OFF)
- Combination model: UDP broadcast discovery, Optional mDNS support, Manual IP entry fallback.
- Discovery packet schema (v1): `protocol_version`, `device_id`, `display_name`, `p2p_tcp_port (54546)`, `identity_key_fingerprint`, `capabilities (bitflags)`.
- Broadcast interval (v1): every 5 seconds.
- Offline timeout (v1): mark peer offline after 15 seconds without broadcast.
- Trust model (v1 decision): No explicit fingerprint or code verification step. First discovered key is automatically trusted. No user-facing verification flow in v1.

### Identity & Auth
- Accounts are LAN-local.
- Server authenticates via username/password.
- Identity is client-generated (device/user identity + keys created on first run).
  - When server is available, the identity is registered to the LAN-local account.
  - Same identity works in server OFF (P2P) and server ON modes.
- E2EE required.
- Password-protected encrypted key bundle stored on server.
- Recovery explicitly deferred.

### v1 Scope
- Text chat
- File sharing
- Voice notes and calls deferred.

### Messaging semantics (v1)
- Message states: Sent + Delivered (no read receipts)
- Delivered definition: recipient must successfully decrypt and send explicit ACK
- Message editing: Not supported in v1
- Message deletion: Delete for everyone supported (no time limit in v1)
  - Can be triggered at any time after sending
  - Deletion request is sent as a signed control message
  - All clients remove the target message from active conversation view
  - Server retains a minimal tombstone record (message_id + deletion flag) to prevent re-sync reappearance
  - Deleted messages are not recoverable in v1
- Message forwarding: Supported in v1
  - Forwarding creates a new message with new message_id
  - Original sender metadata is preserved as “Forwarded from ”
  - Content is re-encrypted for the target conversation (no ciphertext reuse)
  - Forwarded messages can also be deleted using normal deletion rules
- Message reactions: Not supported in v1
- Search (v1): Local-only search
  - Search is performed client-side on locally stored decrypted message cache
  - Server does not index or search message contents (E2EE preserved)
  - Search scope limited to messages available on the device

### File messages in chat history (v1)
- Decision: File metadata stays in chat permanently; file availability may expire.
- Chat contains a file message card (filename, size, sender, timestamp, status).
- If the actual file blob is not available, UI shows “File unavailable” with reason.
- Users may re-request the file from the sender if they are online.
- The message record remains even if the file blob is gone.

### Server relay file retention (v1)
- Decision: Delete relay file blobs immediately after successful download.
- Server stores encrypted chunks only for pending transfers.
- Once recipient completes download and integrity is verified, relay chunks are deleted.
- If transfer is incomplete, chunks follow the 7-day TTL rule.
- Cleanup job required to purge expired or abandoned chunks.

### Rate limiting / abuse controls (v1)
- Decision: No general rate limiting in v1 (LAN trust assumption).
- Exceptions: Login attempts are still rate-limited, Key-bundle fetch requires authentication.

### Data retention strategy (v1)
- Decision: Soft delete for server records.
- Records are not physically removed immediately. `deleted_at` timestamp column used for logical deletion.
- Queries must exclude rows where `deleted_at IS NOT NULL`.
- Periodic cleanup job may permanently purge soft-deleted data after defined retention window.

## 10) Detailed Data Model (Server — PostgreSQL, v1)
All tables use soft delete via `deleted_at TIMESTAMP NULL` unless explicitly noted.

### 10.1 accounts
`id` (UUID, PK), `username` (TEXT, UNIQUE, NOT NULL), `password_hash` (TEXT, NOT NULL) – Argon2id, `created_at` (TIMESTAMP, NOT NULL), `disabled_at` (TIMESTAMP, NULL), `deleted_at` (TIMESTAMP, NULL). Indexes: UNIQUE(username).

### 10.2 devices
`id` (UUID, PK), `account_id` (UUID, FK → accounts.id), `device_id` (UUID, UNIQUE, NOT NULL), `identity_key_public` (BYTEA, NOT NULL), `identity_key_fingerprint` (TEXT, NOT NULL), `created_at` (TIMESTAMP, NOT NULL), `last_seen_at` (TIMESTAMP, NULL), `deleted_at` (TIMESTAMP, NULL). Constraints: UNIQUE(device_id), One account per device_id.

### 10.3 sessions
`id` (UUID, PK), `account_id` (UUID, FK → accounts.id), `device_id` (UUID, FK → devices.id, NULLABLE for web session), `token_hash` (TEXT, NOT NULL), `expires_at` (TIMESTAMP, NOT NULL), `revoked_at` (TIMESTAMP, NULL), `created_at` (TIMESTAMP, NOT NULL), `last_seen_at` (TIMESTAMP, NULL). Indexes: INDEX(account_id), INDEX(expires_at).

### 10.4 prekeys
`id` (UUID, PK), `device_id` (UUID, FK → devices.id), `type` (TEXT CHECK type IN (‘SPK’,‘OPK’)), `public_key` (BYTEA, NOT NULL), `signature` (BYTEA, NULL), `consumed_at` (TIMESTAMP, NULL), `created_at` (TIMESTAMP, NOT NULL), `deleted_at` (TIMESTAMP, NULL). Indexes: INDEX(device_id), INDEX(type).

### 10.5 conversations
`id` (UUID, PK), `type` (TEXT CHECK type IN (‘dm’,‘group’)), `created_at` (TIMESTAMP, NOT NULL), `deleted_at` (TIMESTAMP, NULL).

### 10.6 conversation_members
`conversation_id` (UUID, FK → conversations.id), `account_id` (UUID, FK → accounts.id), `role` (TEXT CHECK role IN (‘creator’,‘admin’,‘member’)), `joined_at` (TIMESTAMP, NOT NULL), `left_at` (TIMESTAMP, NULL), `deleted_at` (TIMESTAMP, NULL). Primary Key: (conversation_id, account_id).

### 10.7 messages
`id` (UUID, PK) – message_id (client-generated), `conversation_id` (UUID, FK → conversations.id), `sender_account_id` (UUID, FK → accounts.id), `sender_device_id` (UUID, FK → devices.id), `server_seq` (BIGINT, NOT NULL), `ciphertext_blob` (BYTEA, NOT NULL), `ciphertext_type` (TEXT), `metadata_json` (JSONB, NULL), `created_at` (TIMESTAMP, NOT NULL), `deleted_at` (TIMESTAMP, NULL). Indexes: INDEX(conversation_id, server_seq), INDEX(sender_account_id).

### 10.8 delivery_receipts
`message_id` (UUID, FK → messages.id), `recipient_account_id` (UUID, FK → accounts.id), `recipient_device_id` (UUID, FK → devices.id), `status` (TEXT CHECK status IN (‘delivered’,‘expired’)), `acked_at` (TIMESTAMP, NULL), `created_at` (TIMESTAMP, NOT NULL). Primary Key: (message_id, recipient_device_id).

### 10.9 file_transfers
`id` (UUID, PK), `conversation_id` (UUID, FK → conversations.id), `sender_account_id` (UUID, FK → accounts.id), `receiver_scope` (TEXT), `file_name` (TEXT, NOT NULL), `size_bytes` (BIGINT, NOT NULL), `transport` (TEXT CHECK transport IN (‘tcp’,‘webrtc’,‘relay’)), `final_hash_sha256` (TEXT, NOT NULL), `status` (TEXT CHECK status IN (‘pending’,‘completed’,‘expired’,‘failed’)), `created_at` (TIMESTAMP, NOT NULL), `expires_at` (TIMESTAMP, NULL), `deleted_at` (TIMESTAMP, NULL). Indexes: INDEX(conversation_id), INDEX(status).

### 10.10 file_chunks_relay
`transfer_id` (UUID, FK → file_transfers.id), `chunk_index` (INTEGER, NOT NULL), `ciphertext_chunk` (BYTEA, NOT NULL), `chunk_hash_sha256` (TEXT, NOT NULL), `created_at` (TIMESTAMP, NOT NULL), `deleted_at` (TIMESTAMP, NULL). Primary Key: (transfer_id, chunk_index).

### 10.11 audit_events (optional but recommended)
`id` (UUID, PK), `event_type` (TEXT), `actor_account_id` (UUID, NULL), `target_account_id` (UUID, NULL), `details_json` (JSONB), `created_at` (TIMESTAMP, NOT NULL).

## 11) Client-Side Storage (SQLite, v1)
Local tables (mirrors + cache): `local_conversations`, `local_messages (decrypted cache)`, `local_file_transfer_state (resume map: chunk bitmap)`, `encrypted_key_bundle_cache`, `device_identity (device_id + public fingerprint)`.
Constraints: Local DB is authoritative for search. Decrypted content never leaves client except as ciphertext.

## 12) Metadata Visibility (Server Can See)
Server can see: Account usernames, Conversation membership, Message timestamps, Message sizes, File sizes and names, Delivery status.
Server cannot see: Message plaintext, File plaintext, Private keys.

---
v1 PRD Status: Functionally Complete
Remaining items are implementation details, not architectural blockers.
