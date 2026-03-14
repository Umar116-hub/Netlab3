# Project Requirements

This document captures the physical definitions, requirements, and tech stacks required to build the LAN Chat + Fast File Share App.

## Prerequisites
- **Node.js**: v18 or v20+ recommended.
- **Package Manager**: `npm` or `yarn` / `pnpm`.
- **Database**: PostgreSQL setup locally.

## Workspaces / Project Boundaries

We are employing a monorepo setup with four modular segments:
1. `server`: Backend fastify application and WebSockets server.
2. `desktop-client`: Electron application for native TCP P2P transfers and native window management.
3. `web-client`: Web browser React interface.
4. `shared`: Common type definitions and cryptographic helper scripts.

## Dependencies (Listed structurally per component)

Unlike a Python application matching `requirements.txt`, Node.js uses `package.json` for dependency management. Below is an overview of the pivotal dependencies per module:

### 1. Server Stack
- **fastify**: The underlying API framework (high performance).
- **fastify-websocket**: WebSocket implementations for text transport.
- **pg**: PostgreSQL native drivers.
- **argon2**: Used for high-security password hashing.
- **dotenv**: Storing application secrets securely locally.

### 2. Desktop Client Stack
- **electron**: Creating the compiled desktop layer.
- **react** / **react-dom**: Reactive UI framework.
- **vite**: Quick scaffolding and hot-reloads over React.
- **sqlite3 / better-sqlite3**: Retaining encrypted message logs consistently.

### 3. Web Client Stack
- **react** / **react-dom**: Mirroring the components created for the desktop application.
- **vite**: The build tool structure.
- Native APIs: Leverage WebRTC implicitly via `window.RTCPeerConnection` for browser-based file transfer.

### 4. Cross-Communication Stack (Shared)
- **typescript**: Ensures `server` and `clients` agree on data contracts strictly. 

---
### Infrastructure Limits
- Files max size: 2GB (Chunck size: 1 MiB limits).
- Delivery receipt confirmation.
- 7 days offline Time To Live (TTL) storage requirement for queued files.
