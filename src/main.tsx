import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { useStore } from './store/store';

// Handy for debugging in development builds only.
if (import.meta.env.DEV) (window as unknown as { __brs: typeof useStore }).__brs = useStore;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
