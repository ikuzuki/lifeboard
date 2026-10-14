import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SetupGate } from './components/Setup';
import { applyTheme, readTheme, watchSystemTheme } from './lib/theme';
import { registerServiceWorker } from './lib/pwa';

// Before render, so the first paint is already the right theme rather than flashing light.
applyTheme(readTheme());
watchSystemTheme();

// Offline shell and installability. Registration is hand-rolled rather than injected so a
// waiting worker is surfaced to the user instead of activating behind their back.
registerServiceWorker();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <SetupGate />
    </ErrorBoundary>
  </StrictMode>,
);
