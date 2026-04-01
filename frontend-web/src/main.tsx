import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider, WebSocketProvider } from './context/AuthContext.tsx';
import { TransferProvider } from './context/TransferContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <WebSocketProvider>
        <TransferProvider>
          <App />
        </TransferProvider>
      </WebSocketProvider>
    </AuthProvider>
  </StrictMode>,
);
