# NetLab3 Setup & Development Guide

This guide explains how to set up and run the NetLab3 project on a new device.

## Prerequisites
- **Node.js**: Version 18 or higher is recommended.
- **Git**: Installed on your system.

## 1. Cloning the Repository
```bash
git clone <your-repository-url>
cd netlab3
```

## 2. Initial Installation
You need to install dependencies in the root and all sub-projects. You can do this manually:

```bash
# Install root dependencies
npm install

# Install shared dependencies
cd shared && npm install && cd ..

# Install backend dependencies
cd backend && npm install && cd ..

# Install web frontend dependencies
cd frontend-web && npm install && cd ..

# Install desktop frontend dependencies
cd frontend-desktop && npm install && cd ..
```

## 3. Running the Project

### Web Version (Recommended for testing first)
1. Start the Backend:
   ```bash
   cd backend
   npm run dev
   ```
2. Start the Web Frontend (in a new terminal):
   ```bash
   cd frontend-web
   npm run dev
   ```

### Desktop Version
1. Start the Backend (as above).
2. Start the Desktop Frontend:
   ```bash
   cd frontend-desktop
   npm run dev
   ```
   *Note: This will launch the Electron application.*

## 4. Building for Production
If you need to create the `.exe` installers again:
```bash
cd frontend-desktop
npm run build
# The installers will be generated in the 'dist' folder.
```

## Troubleshooting
- **Port Conflicts**: Ensure ports 3000, 5173, and 5174 are free.
- **Missing Shared Types**: Ensure `shared/node_modules` is installed as the other packages depend on it.
