# NetLab LAN Talk

NetLab LAN Talk is a multi-device file sharing and chat application designed to work over a Local Area Network (LAN). It features persistent storage for file transfers and a modern, responsive UI for both web and desktop.

## ✨ Features
- **Instant LAN Chat**: Connect and chat with anyone on your local network.
- **P2P File Transfer**: High-speed file sharing directly between devices.
- **Persistent History**: All file offers ("Offer Sent", "Received", "Unreceived") stay in the chat even after refreshing.
- **Multi-Device Support**: Works in any web browser and as a native Windows desktop app.

---

## 🚀 Quick Start (Web Version)

### 1. Install Dependencies
Run this in the root folder:
```powershell
npm install
cd shared; npm install; cd ..
cd backend; npm install; cd ..
cd frontend-web; npm install; cd ..
```

### 2. Run the App
**Start the Backend (Terminal 1):**
```powershell
cd backend
npm run dev
```

**Start the Web Frontend (Terminal 2):**
```powershell
cd frontend-web
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 🖥️ Desktop Version (Electron)

### 1. Install Desktop Dependencies
```powershell
cd frontend-desktop
npm install
```

### 2. Run the Desktop App
```powershell
npm run dev
```

### 3. Syncing with a Remote Backend
If you are running the desktop app on a **different laptop** and want it to connect back to your main laptop's backend:
1. Find your main laptop's IP (e.g., `192.168.1.5`).
2. Open `frontend-desktop/.env`.
3. Set your IP: `VITE_API_URL=http://192.168.1.5:3004`

---

## 🛠️ Project Structure
- **/backend**: Fastify-based server with SQLite for persistent messaging.
- **/frontend-web**: React + Vite web application.
- **/frontend-desktop**: Electron + React desktop application.
- **/shared**: Shared TypeScript types and business logic.

## 📦 Building for Production
To create a portable `.exe` for the desktop app:
```powershell
cd frontend-desktop
npm run pack
```
Installers will appear in `frontend-desktop/release`.

---
*Created with ❤️ for NetLab.*
